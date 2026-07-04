// cloudfunctions/aiColorize/index.js
// AI 老照片上色云函数 —— 异步任务模式（无本地伪上色兜底）
//
// 设计：上色耗时较长（数秒~3 分钟），单次云函数调用易超时，故采用「提交 → taskId → 轮询」：
//   action='submit' (默认): 下载原图 → 内容安全 → 创建 Replicate DeOldify 预测 → 返回 taskId
//   action='query':          按 taskId 轮询；succeeded → 下载结果 → 上传云存储 → 返回 fileID
//
// 关键约束（与 aiUpscale 不同）：
//   本功能不提供「本地 Canvas 伪上色」兜底。AI 服务不可用 / 失败时，
//   直接返回「当前服务繁忙，请稍后再试」，绝不生成低质量伪结果。
//
// 上色模型：Replicate DeOldify（arielreplicate/deoldify_image，付费 API，约 $0.039/次，含免费额度）
//   真实能力（已由 openapi_schema 实测核验）：
//     输入 input_image（图片，必填）+ model_name('Stable'|'Artistic') + render_factor(7~45)
//   风格映射（基于模型 README 实际描述，非虚构）：
//     自然 → model_name='Stable'（landscape/portrait 友好，色彩克制自然，更少"僵尸"误色）
//     复古 → model_name='Artistic'（细节与色彩更丰富、更浓郁，胶片感更强）
//   多模型按序尝试，模型名/版本均可通过环境变量配置，便于切换供应商。
//
// 输入：
//   submit: { fileID, style('natural'|'vintage') }
//   query:  { action:'query', taskId }
// 输出（归一化错误码）：
//   { success, status:'processing'|'succeeded'|'failed', taskId?, fileID?, reason?, errorCode?, engine? }
//   errorCode ∈ E001_缺少参数 / E002_内容违规 / E003_服务不可用 / E004_超时 / E005_格式不支持 / E009_未知

const cloud = require('wx-server-sdk');
const axios = require('axios');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 单次提交/查询的网络超时（ms）
const HTTP_TIMEOUT = 30000;
// 风格 → DeOldify model_name 映射
const SUPPORTED_STYLES = { natural: 'Stable', vintage: 'Artistic' };
// 默认渲染因子（DeOldify 建议 21~35；过高耗时长，过低细节少，35 兼顾质量与速度）
const DEFAULT_RENDER_FACTOR = 35;
// 服务繁忙统一文案（不向用户暴露内部错误细节）
const BUSY_MSG = '当前服务繁忙，请稍后再试';

// ============================================================
// 主入口 —— 按 action 分发，预留 provider 扩展位
// ============================================================
exports.main = async (event, context) => {
  const action = event.action || 'submit';
  try {
    if (action === 'query') return await queryTask(event);
    return await submitTask(event);
  } catch (err) {
    console.error('[aiColorize] 主流程异常:', err);
    return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: normalizeErrorCode(err) };
  }
};

// ============================================================
// 提交任务
// ============================================================
async function submitTask(event) {
  const { fileID, style } = event;
  if (!fileID) {
    return { success: false, status: 'failed', reason: '缺少图片参数 fileID', errorCode: 'E001' };
  }
  const modelType = SUPPORTED_STYLES[style] || SUPPORTED_STYLES.natural;

  // 1. 下载原图
  let imageBuffer;
  try {
    const dl = await cloud.downloadFile({ fileID });
    imageBuffer = dl.fileContent;
  } catch (e) {
    console.error('[aiColorize] 下载原图失败:', e);
    return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: 'E003' };
  }

  // 2. 服务端内容安全兜底（违规则抛错，外层转 E002）
  try {
    await contentCheck.assertImageSafe(imageBuffer, cloud, detectContentType(fileID));
  } catch (e) {
    return { success: false, status: 'failed', reason: e.message || '图片包含违规内容', errorCode: 'E002' };
  }

  // 3. Replicate 不可用 → 直接报「服务繁忙」（约束：不降级本地伪上色）
  const creds = secret.getAllCredentials();
  if (!creds.replicateAvailable) {
    console.warn('[aiColorize] Replicate 未配置，拒绝服务（不降级伪上色）');
    return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: 'E003' };
  }

  // 4. 创建 DeOldify 预测（无状态：taskId 即 prediction id）
  try {
    const prediction = await createDeoldifyPrediction(imageBuffer, modelType, creds);
    if (prediction && prediction.id) {
      return {
        success: true,
        status: prediction.status === 'succeeded' ? 'succeeded' : 'processing',
        taskId: prediction.id,
        style: style || 'natural'
      };
    }
    return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: 'E003' };
  } catch (e) {
    // 422 = 入参 schema 不匹配；5xx = Replicate 故障。均如实报「服务繁忙」，不伪造结果
    console.warn('[aiColorize] 创建预测失败:', e.response ? e.response.status : '', e.message);
    return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: 'E003' };
  }
}

// ============================================================
// 查询任务
// ============================================================
async function queryTask(event) {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, status: 'failed', reason: '缺少任务 ID taskId', errorCode: 'E001' };
  }

  const creds = secret.getAllCredentials();
  if (!creds.replicateAvailable) {
    return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: 'E003' };
  }

  let pred;
  try {
    pred = await axios.get(`https://api.replicate.com/v1/predictions/${taskId}`, {
      headers: { Authorization: `Token ${creds.replicateToken}` },
      timeout: HTTP_TIMEOUT
    });
  } catch (e) {
    // 瞬时错误（超时/网络中断/5xx/429）→ 当作「还在处理」，前端继续轮询，
    // 避免一次网络毛刺就让整单判死（已付费预测被白白浪费）。
    const noResp = !e.response;
    const code = e.response && e.response.status;
    const transient = noResp || code === 429 || code >= 500;
    if (transient) {
      console.warn('[aiColorize] 查询瞬时失败，将继续轮询:', e.code || code || 'network', e.message);
      return { success: true, status: 'processing', taskId };
    }
    // 终态错误（404 任务不存在 / 401 鉴权失败 / 400）→ 重试无意义，如实报繁忙
    console.error('[aiColorize] 查询终态失败:', code || '', e.message);
    return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: 'E003' };
  }

  const data = (pred && pred.data) || {};
  const status = data.status;

  if (status === 'succeeded') {
    const outputUrl = parseReplicateOutput(data.output);
    if (!outputUrl) {
      return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: 'E003' };
    }
    try {
      const imgRes = await axios.get(outputUrl, { responseType: 'arraybuffer', timeout: HTTP_TIMEOUT });
      const buffer = Buffer.from(imgRes.data);
      const ext = String(data.output || '').match(/\.(\w+)(\?|$)/);
      const suffix = ext ? ext[1].toLowerCase() : 'png';
      const upload = await cloud.uploadFile({
        cloudPath: `aiColorize/${Date.now()}.${suffix === 'jpg' ? 'jpg' : 'png'}`,
        fileContent: buffer
      });
      return { success: true, status: 'succeeded', fileID: upload.fileID, engine: 'replicate-deoldify' };
    } catch (e) {
      console.error('[aiColorize] 结果下载/上传失败:', e.message);
      return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: 'E003' };
    }
  }

  if (status === 'failed' || status === 'canceled') {
    // 上色模型失败（如内容被判违规、推理崩溃）→ 不降级，如实报繁忙
    return { success: false, status: 'failed', reason: BUSY_MSG, errorCode: 'E003' };
  }

  // processing / starting —— 继续轮询
  return { success: true, status: 'processing', taskId };
}

// ============================================================
// Replicate DeOldify 预测创建
// 真实输入（已由 openapi_schema 实测核验 arielreplicate/deoldify_image）：
//   input_image (图片，必填) / model_name ('Stable'|'Artistic') / render_factor (7~45)
//
// 端点选择（关键）：
//   优先用 /v1/predictions + version hash（通用，兼容老模型）。
//   version 优先取配置；未配置则 GET /v1/models/{owner}/{name} 动态拉取 latest_version.id。
//   原因：部分老模型（如 2023-01 创建的 deoldify_image）不支持
//   /models/{owner}/{name}/predictions 快捷端点（会 404），但 version 方式始终可用。
//   仅当版本解析失败时，才回退尝试快捷端点。
// ============================================================
async function createDeoldifyPrediction(imageBuffer, modelType, creds) {
  const imageBase64 = imageBuffer.toString('base64');
  const models = creds.replicateColorizeModels;
  const headers = { Authorization: `Token ${creds.replicateToken}`, 'Content-Type': 'application/json' };

  const inputBody = {
    input: {
      input_image: `data:image/png;base64,${imageBase64}`,
      model_name: modelType,        // 'Stable' | 'Artistic'（模型 README 所述两种变体）
      render_factor: DEFAULT_RENDER_FACTOR
    }
  };

  let lastErr;
  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    try {
      // 1) 解析版本：优先配置 version，否则动态拉取 latest_version.id
      let version = creds.replicateColorizeVersion;
      if (!version || version.length <= 20) {
        version = await resolveLatestVersion(modelName, creds);
      }

      // 2) 用 version 创建预测（通用端点，兼容老模型）
      if (version) {
        const res = await axios.post(
          'https://api.replicate.com/v1/predictions',
          Object.assign({ version }, inputBody),
          { headers, timeout: HTTP_TIMEOUT }
        );
        if (res.data && res.data.id) return res.data;
        lastErr = new Error('Replicate 返回无 id');
      } else {
        // 3) 版本解析失败时兜底：尝试 /models/{owner}/{name}/predictions 快捷端点
        const res = await axios.post(
          `https://api.replicate.com/v1/models/${modelName}/predictions`,
          inputBody,
          { headers, timeout: HTTP_TIMEOUT }
        );
        if (res.data && res.data.id) return res.data;
        lastErr = new Error('Replicate 返回无 id（版本兜底）');
      }
    } catch (e) {
      lastErr = e;
      const rd = e.response && e.response.data;
      console.warn(
        `[aiColorize] 模型 ${modelName} 创建失败:`,
        e.response ? e.response.status : 'network',
        rd ? JSON.stringify(rd).substring(0, 400) : ''
      );
    }
  }
  throw lastErr || new Error('所有上色模型均创建失败');
}

// 动态解析模型最新版本 hash：GET /v1/models/{owner}/{name} → latest_version.id
// 同时打印 openapi_schema 中的输入字段名（便于核对入参，避免字段名不匹配的 422）
async function resolveLatestVersion(modelName, creds) {
  try {
    const res = await axios.get(`https://api.replicate.com/v1/models/${modelName}`, {
      headers: { Authorization: `Token ${creds.replicateToken}` },
      timeout: HTTP_TIMEOUT
    });
    const lv = res.data && res.data.latest_version;
    const id = lv && lv.id;
    if (id) {
      console.log('[aiColorize] 模型', modelName, '最新版本:', id);
      // 记录模型真实输入字段名（ground truth，便于排查入参不匹配）
      try {
        const props = lv.openapi_schema
          && lv.openapi_schema.components
          && lv.openapi_schema.components.schemas
          && lv.openapi_schema.components.schemas.Input
          && lv.openapi_schema.components.schemas.Input.properties;
        if (props) {
          console.log('[aiColorize] 模型输入字段:', Object.keys(props).join(', '));
          // 打印各字段完整 schema（类型/枚举/默认值），便于核对取值，避免 422
          try {
            console.log('[aiColorize] 输入字段 schema:', JSON.stringify(props).substring(0, 1500));
          } catch (_) { /* 忽略序列化异常 */ }
        }
      } catch (_) { /* openapi_schema 结构异常时忽略，不影响主流程 */ }
      return id;
    }
    console.warn('[aiColorize] 模型', modelName, '响应未包含 latest_version');
  } catch (e) {
    console.warn(
      '[aiColorize] 解析模型版本失败:', modelName,
      e.response ? e.response.status : '', e.message
    );
  }
  return '';
}

// Replicate 输出可能是 string / string[] / 对象
function parseReplicateOutput(output) {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output.length > 0) return output[output.length - 1];
  if (typeof output === 'object') return output.url || output.output || Object.values(output)[0] || '';
  return '';
}

// 从 fileID / 文件名推断 MIME（仅用于内容安全送检）
function detectContentType(fileID) {
  const s = String(fileID || '').toLowerCase();
  if (s.endsWith('.png')) return 'image/png';
  if (s.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

// 错误码归一化
function normalizeErrorCode(err) {
  const m = (err && err.message) || '';
  if (/超时|timeout|timed out/i.test(m)) return 'E004';
  if (/格式|format|unsupported/i.test(m)) return 'E005';
  if (/违规|risk/i.test(m)) return 'E002';
  if (/参数|param|缺少/.test(m)) return 'E001';
  return 'E009';
}
