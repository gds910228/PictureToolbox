// cloudfunctions/aiUpscale/index.js
// AI 图片放大增强云函数 —— 异步任务模式 + 三级降级
//
// 设计：放大耗时较长（10~60s），单次云函数调用易超时，故采用「提交 → taskId → 轮询」：
//   action='submit' (默认): 下载原图 → 内容安全 → 创建 Replicate 预测 → 返回 taskId
//   action='query':          按 taskId 轮询 Replicate；succeeded → 下载结果 → 上传云存储 → 返回 fileID
//
// 降级策略：
//   Level 1: Replicate Real-ESRGAN（高质量超分，付费 API：Replicate 按推理计费，有免费额度）
//   Level 2: Replicate 不可用 / 提交失败 / 预测失败 → 返回 mode='local'，前端走本地基础放大
//
// 输入：
//   submit: { fileID, scale(2|4) }
//   query:  { action:'query', taskId }
// 输出（归一化错误码）：
//   { success, mode:'ai'|'local', status:'processing'|'succeeded'|'failed',
//     taskId?, fileID?, reason?, errorCode? }
//   errorCode ∈ E001_缺少参数 / E002_内容违规 / E003_服务不可用 / E004_超时 / E005_格式不支持 / E009_未知

const cloud = require('wx-server-sdk');
const axios = require('axios');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 单次提交/查询的网络超时（ms）
const HTTP_TIMEOUT = 30000;
// Replicate 单图最大等待（submit 侧不轮询，仅作调用保护）
const SUPPORTED_SCALES = [2, 4];

// ============================================================
// 主入口 —— 按 action 分发，预留 provider 扩展位
// ============================================================
exports.main = async (event, context) => {
  const action = event.action || 'submit';

  try {
    if (action === 'query') {
      return await queryTask(event);
    }
    return await submitTask(event);
  } catch (err) {
    console.error('[aiUpscale] 主流程异常:', err);
    return {
      success: false,
      mode: 'local',
      status: 'failed',
      reason: '云端处理出错：' + (err.message || '未知错误') + '，可使用本地基础放大',
      errorCode: normalizeErrorCode(err)
    };
  }
};

// ============================================================
// 提交任务
// ============================================================
async function submitTask(event) {
  const { fileID, scale } = event;

  if (!fileID) {
    return { success: false, mode: 'local', status: 'failed', reason: '缺少图片参数 fileID', errorCode: 'E001' };
  }
  const targetScale = SUPPORTED_SCALES.includes(Number(scale)) ? Number(scale) : 2;

  // 1. 下载原图
  let imageBuffer;
  try {
    const dl = await cloud.downloadFile({ fileID });
    imageBuffer = dl.fileContent;
  } catch (e) {
    console.error('[aiUpscale] 下载原图失败:', e);
    return { success: false, mode: 'local', status: 'failed', reason: '下载原图失败', errorCode: 'E003' };
  }

  // 2. 服务端内容安全兜底（违规则抛错，外层转 E002）
  try {
    await contentCheck.assertImageSafe(imageBuffer, cloud, detectContentType(fileID));
  } catch (e) {
    return { success: false, mode: 'local', status: 'failed', reason: e.message || '图片包含违规内容', errorCode: 'E002' };
  }

  // 3. 检查 Replicate 是否可用；不可用直接降级本地
  const creds = secret.getAllCredentials();
  if (!creds.replicateAvailable) {
    return {
      success: true,
      mode: 'local',
      status: 'succeeded',
      reason: '未配置 Replicate 密钥，已切换到本地基础放大（效果弱于 AI 放大）',
      errorCode: 'E003'
    };
  }

  // 4. 创建 Replicate 预测（无状态：taskId 即 prediction id，查询时按 id 取回）
  try {
    const prediction = await createEsrganPrediction(imageBuffer, targetScale, creds);
    if (prediction && prediction.id) {
      return {
        success: true,
        mode: 'ai',
        status: prediction.status === 'succeeded' ? 'succeeded' : 'processing',
        taskId: prediction.id,
        scale: targetScale
      };
    }
    return { success: false, mode: 'local', status: 'failed', reason: '创建 AI 任务失败', errorCode: 'E003' };
  } catch (e) {
    console.warn('[aiUpscale] 创建预测失败，降级本地:', e.message);
    return {
      success: true,
      mode: 'local',
      status: 'succeeded',
      reason: 'AI 服务暂不可用：' + e.message + '，已切换到本地基础放大',
      errorCode: 'E003'
    };
  }
}

// ============================================================
// 查询任务
// ============================================================
async function queryTask(event) {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, mode: 'local', status: 'failed', reason: '缺少任务 ID taskId', errorCode: 'E001' };
  }

  const creds = secret.getAllCredentials();
  if (!creds.replicateAvailable) {
    return { success: false, mode: 'local', status: 'failed', reason: 'AI 服务不可用，请使用本地基础放大', errorCode: 'E003' };
  }

  let pred;
  try {
    pred = await axios.get(`https://api.replicate.com/v1/predictions/${taskId}`, {
      headers: { 'Authorization': `Token ${creds.replicateToken}` },
      timeout: HTTP_TIMEOUT
    });
  } catch (e) {
    console.error('[aiUpscale] 查询预测失败:', e.message);
    return { success: false, mode: 'local', status: 'failed', reason: '查询 AI 任务失败', errorCode: 'E003' };
  }

  const status = pred.data && pred.data.status;
  const data = pred.data || {};

  if (status === 'succeeded') {
    const outputUrl = parseReplicateOutput(data.output);
    if (!outputUrl) {
      return { success: false, mode: 'local', status: 'failed', reason: 'AI 返回结果为空', errorCode: 'E003' };
    }
    try {
      const imgRes = await axios.get(outputUrl, { responseType: 'arraybuffer', timeout: HTTP_TIMEOUT });
      const buffer = Buffer.from(imgRes.data);
      const ext = (data.output || '').match(/\.(\w+)(\?|$)/);
      const suffix = ext ? ext[1].toLowerCase() : 'png';
      const upload = await cloud.uploadFile({
        cloudPath: `aiUpscale/${Date.now()}.${suffix === 'jpg' ? 'jpg' : 'png'}`,
        fileContent: buffer
      });
      return { success: true, mode: 'ai', status: 'succeeded', fileID: upload.fileID, engine: 'replicate-real-esrgan' };
    } catch (e) {
      console.error('[aiUpscale] 结果下载/上传失败:', e.message);
      return { success: false, mode: 'local', status: 'failed', reason: '结果保存失败', errorCode: 'E003' };
    }
  }

  if (status === 'failed' || status === 'canceled') {
    return {
      success: false,
      mode: 'local',
      status: 'failed',
      reason: 'AI 处理失败：' + (data.error || status) + '，可使用本地基础放大',
      errorCode: 'E003'
    };
  }

  // processing / starting
  return { success: true, mode: 'ai', status: 'processing', taskId };
}

// ============================================================
// Replicate Real-ESRGAN 预测创建
// 真实能力：input { image(必填), scale(2|3|4), face_enhance(可选) }
// 文档：https://replicate.com/nightmareai/real-esrgan  （无 noise 参数，故不虚构）
// 多模型按序尝试；version hash 为空时走 /models/{owner}/{name}/predictions（取最新版本）
// ============================================================
async function createEsrganPrediction(imageBuffer, scale, creds) {
  const imageBase64 = imageBuffer.toString('base64');
  const models = creds.replicateEsrganModels;
  const version = creds.replicateEsrganVersion;
  const useVersion = version && version.length > 20;

  const inputBody = {
    input: {
      image: `data:image/png;base64,${imageBase64}`,
      scale: scale
    }
  };

  let lastErr;
  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    const url = useVersion
      ? 'https://api.replicate.com/v1/predictions'
      : `https://api.replicate.com/v1/models/${modelName}/predictions`;
    const body = useVersion ? Object.assign({ version }, inputBody) : inputBody;

    try {
      const res = await axios.post(url, body, {
        headers: { 'Authorization': `Token ${creds.replicateToken}`, 'Content-Type': 'application/json' },
        timeout: HTTP_TIMEOUT
      });
      if (res.data && res.data.id) {
        return res.data;
      }
      lastErr = new Error('Replicate 返回无 id');
    } catch (e) {
      lastErr = e;
      const rd = e.response && e.response.data;
      console.warn(`[aiUpscale] 模型 ${modelName} 创建失败:`, e.response ? e.response.status : 'network', rd ? JSON.stringify(rd).substring(0, 300) : '');
    }
  }
  throw lastErr || new Error('所有 Real-ESRGAN 模型均创建失败');
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
