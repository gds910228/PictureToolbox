// cloudfunctions/pdfToImage/index.js
// PDF 转图片云函数 —— 腾讯云数据万象（CI）文档预览 doc-preview（同步，每页一次调用）
//
// 定位：把用户上传的 PDF 逐页渲染为图片。文档转换工具（非 AI 生成），与 imgToPdf 互逆，
//      补全"基础处理"组。spec 原方案 pdfjs+@napi-rs/canvas 有原生依赖 / 内存 / 超时风险，
//      改用 CI doc-preview：渲染在 CI 服务器，云函数只搬运，零原生依赖、质量更好、还支持 Word/PPT。
//
// 架构（规避云函数 60s 超时 + CI 同步 10s/页）：
//   - 同步、每页一次云函数调用（单页 ~10–15s，稳进 60s），不做多页一次性渲染。
//   - 客户端 chooseMessageFile 选 PDF → uploadFile 拿 fileID → 逐页 callFunction('pdfToImage')。
//   - page=1：downloadFile 下载原图 → 上传到 CI 桶（确定 key，会话内复用）→ CI 渲染首页
//             （响应头 X-Total-Page 拿总页数）→ 上传结果图到云存储 → 返 fileID + totalPage。
//   - page>1：headObject 确认 PDF 在桶（缺则补传）→ CI 渲染该页 → 上传云存储 → 返 fileID。
//   - 客户端拿到 totalPage 后并发取 2..N（前端限并发 3），上限 30 页。
//
// 接口（CI 文档转码同步请求，已核对官方文档 cloud.tencent.com/document/product/436/121090）：
//   GET /<Key>?ci-process=doc-preview&page=N&srcType=pdf&dstType=png|jpg&scale=10..200
//   响应头 X-Total-Page = 文档总页数；Body = 该页图片二进制。
//   经 cos-nodejs-sdk-v5 的 getObject({Query:{...}}) 调用，SDK 负责签名 ci-process 等查询参数。
//
// 诚信约定（对齐项目）：
//   1. CI 未配置（COS_BUCKET 占位 / 密钥缺）→ demo:true，前端标注"示例：需配置 CI 服务"。
//   2. 已配置但调用失败 → success:false + 归一化错误，绝不静默伪造结果。
//
// 限流：复用 rate-limiter，featureKey='pdftoimage'，仅 page=1 计数（每 PDF 1 次）。
//      限额 RATE_LIMIT_DAILY（缺省 20，本函数 config 默认 10）防刷 CI 计费。
// 内容安全：文档转换工具（同 imgToPdf），不做服务端 imgSecCheck；UI 引导"请确保文档合规"。
// 时区：云函数跑 UTC，按日计数用北京时间。
// 清理：CI 桶内 PDF 由 COS 生命周期规则过期清理（建议 1 天），云函数不负责删除。

const crypto = require('crypto');
const cloud = require('wx-server-sdk');
const COS = require('cos-nodejs-sdk-v5');
const secret = require('./cloud-secret');
const rateLimiter = require('./rate-limiter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const FEATURE_KEY = 'pdftoimage';
const MAX_PAGES = 50;                       // 单次转换页数上限（CI 接口支持 5000 页；此为防超时 + 防计费失控）
const MAX_PDF_BYTES = 50 * 1024 * 1024;     // 50MB（CI 接口接受 200MB；云函数 256MB 内存下载上限，留渲染余量）
const SUPPORTED_FORMATS = ['png', 'jpg'];
const SUPPORTED_SCALES = [100, 150];        // scale 取值 [10,200]；100 标准 / 150 高清（200 过慢过大）

// ============ COS 配置（环境变量）============
function _isPlaceholder(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  return /your_|你的|替换|xxxx|example|placeholder|_here/i.test(s);
}
function getCosBucket() {
  const v = process.env.COS_BUCKET;
  return _isPlaceholder(v) ? '' : String(v).trim();
}
function getCosRegion() {
  const r = process.env.COS_REGION;
  return _isPlaceholder(r) ? secret.getRegion() : String(r).trim();
}
function isConfigured() {
  const cred = secret.getCredentials();
  return cred.available && !!getCosBucket();
}

/**
 * PDF 转图片
 * @param {Object} event
 *   - action:'quota'：只读当日已用次数（前端额度条），不计数
 *   - action:'convert'（默认）: { fileID, page, format?, scale? } → 渲染第 page 页
 *     · page=1 额外返回 totalPage（真实总页数，前端按需提示"仅前 30 页"）
 * @returns {Object} - { success, fileID, page, totalPage?, demo?, used?, limit? | error?, errorCode? }
 */
exports.main = async (event, context) => {
  const action = event.action || 'convert';

  // 只读额度查询分支
  if (action === 'quota') {
    const wxCtxQ = cloud.getWXContext();
    const openidQ = wxCtxQ && wxCtxQ.OPENID;
    if (!isConfigured()) {
      return { success: true, demo: true, used: 0, limit: rateLimiter.resolveLimit() };
    }
    return await rateLimiter.queryQuota(openidQ, FEATURE_KEY, cloud);
  }

  // 转换分支
  const { fileID, format, scale } = event;
  const pageNo = Number(event.page);

  try {
    if (!fileID) {
      return { success: false, error: '缺少文件参数' };
    }
    if (!isFinite(pageNo) || pageNo < 1 || pageNo > MAX_PAGES) {
      return { success: false, error: `仅支持转换前 ${MAX_PAGES} 页` };
    }
    const fmt = SUPPORTED_FORMATS.includes(format) ? format : 'png';
    const sc = SUPPORTED_SCALES.includes(Number(scale)) ? Number(scale) : 100;

    const wxCtx = cloud.getWXContext();
    const openid = (wxCtx && wxCtx.OPENID) || 'anon';

    // CI 未配置 → demo（前端标注"示例"，不渲染）
    if (!isConfigured()) {
      return { success: true, demo: true, totalPage: 0, page: pageNo };
    }

    const cred = secret.getCredentials();
    const cos = new COS({
      SecretId: cred.secretId,
      SecretKey: cred.secretKey,
      Timeout: 30000 // 单次 COS 请求 30s 上限（CI 同步约 10s）
    });
    const cosKey = buildCosKey(openid, fileID);

    // 按页计数：CI 按页计费，按页限流才对得上成本；每渲染一页 inc(1)。
    // （早先仅 page=1 计数 → 用户重试/误点 page=1 易耗尽额度，且 30 页大文档只算 1 次反而防不住成本）
    const rl = await rateLimiter.checkRateLimit(openid, FEATURE_KEY, cloud);
    console.log('[pdfToImage] checkRateLimit', { openid, page: pageNo, ok: rl.ok, used: rl.used, limit: rl.limit });
    if (!rl.ok) {
      return {
        success: false,
        error: 'rate_limit',
        limit: rl.limit,
        used: rl.used,
        resetAt: '次日0点'
      };
    }

    // 确保 PDF 已在 CI 桶（page=1 强制上传；page>1 head 确认，缺则补传）
    await ensurePdfInCos(cos, cosKey, fileID, pageNo === 1);

    // CI 渲染该页 → 图片 buffer + 总页数（仅 page=1 响应头带 X-Total-Page）
    const rendered = await renderPage(cos, cosKey, pageNo, fmt, sc);
    if (!rendered.body || !rendered.body.length) {
      throw new Error('CI 渲染返回为空');
    }

    // 上传结果图到云存储 → fileID（对齐项目"云函数返 fileID"模式，前端不直连 COS 桶）
    const ext = fmt === 'jpg' ? 'jpg' : 'png';
    const cloudPath = `pdfToImage/${sanitizeOpenid(openid)}/${Date.now()}_p${pageNo}.${ext}`;
    const upload = await cloud.uploadFile({ cloudPath, fileContent: rendered.body });

    const result = {
      success: true,
      fileID: upload.fileID,
      page: pageNo,
      demo: false,
      used: rl.used,
      limit: rl.limit
    };
    if (pageNo === 1) {
      result.actualTotalPage = rendered.totalPage || 0;       // 真实总页数
      result.totalPage = Math.min(rendered.totalPage || 0, MAX_PAGES); // 前端实际可取页数
    }
    return result;
  } catch (err) {
    console.error('[pdfToImage] 转换失败', err);
    const n = normalizeError(err);
    return { success: false, error: n.message, errorCode: n.code };
  }
};

// ============ COS / CI 操作 ============

/**
 * 构造 CI 桶内 PDF 对象 key（按 openid + fileID 哈希确定性生成，会话内 page1..N 复用同一对象）。
 */
function buildCosKey(openid, fileID) {
  const hash = crypto.createHash('md5').update(String(fileID)).digest('hex');
  return `pdfToImage/${sanitizeOpenid(openid)}/${hash}.pdf`;
}

function sanitizeOpenid(openid) {
  return String(openid || 'anon').replace(/[^\w-]/g, '') || 'anon';
}

/**
 * 确保 PDF 已上传到 CI 桶。
 *  - force（page=1）：始终下载 + 上传（覆盖，幂等）。
 *  - 非 force（page>1）：先 headObject，存在则跳过；不存在（如桶被生命周期清理）则补传。
 */
async function ensurePdfInCos(cos, cosKey, fileID, force) {
  const Bucket = getCosBucket();
  const Region = getCosRegion();
  if (!force) {
    try {
      await cos.headObject({ Bucket, Region, Key: cosKey });
      return; // 已存在，复用
    } catch (e) {
      // 不存在 / 异常 → 继续上传
    }
  }
  const dl = await cloud.downloadFile({ fileID });
  const buf = dl && dl.fileContent;
  if (!buf || !buf.length) {
    throw new Error('PDF 读取失败，请重新上传');
  }
  if (buf.length > MAX_PDF_BYTES) {
    throw new Error('PDF 过大，请压缩后重试（限 20MB）');
  }
  assertPdfMagic(buf);
  await cos.putObject({ Bucket, Region, Key: cosKey, Body: buf });
}

/**
 * 调 CI doc-preview 渲染指定页为图片。
 * 返回 { body: Buffer, totalPage: number }（totalPage 仅 page=1 响应头带，其余为 0）。
 */
async function renderPage(cos, cosKey, pageNo, fmt, scale) {
  const Bucket = getCosBucket();
  const Region = getCosRegion();
  const resp = await cos.getObject({
    Bucket,
    Region,
    Key: cosKey,
    Query: {
      'ci-process': 'doc-preview',
      page: String(pageNo),
      srcType: 'pdf',
      dstType: fmt,
      scale: String(scale)
    }
  });
  const body = Buffer.isBuffer(resp && resp.Body)
    ? resp.Body
    : Buffer.from((resp && resp.Body) || '');
  const headers = (resp && resp.headers) || {};
  const totalPage = Number(headers['x-total-page'] || headers['X-Total-Page'] || 0) || 0;
  return { body, totalPage };
}

/**
 * PDF 文件头校验（%PDF），防误传非 PDF 走到 CI 才报错。
 */
function assertPdfMagic(buf) {
  if (!buf || buf.length < 5) {
    throw new Error('文件格式异常，请上传 PDF 文件');
  }
  // %PDF
  if (buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) {
    throw new Error('请上传 PDF 文件');
  }
}

/**
 * 错误归一化：把 COS / CI / 内部错误映射为面向用户的友好文案 + errorCode。
 *  - rate_limit → "今日额度已用完"
 *  - CI 文档处理未开通（FunctionNotEnabled / -10104）→ 引导管理员开通（终端用户给通用文案）
 *  - PDF 未就绪（NoSuchKey / 404）→ "请重新转换"
 *  - 非 PDF / 过大 → 对应引导
 *  - 违规（CI 偶发返回）→ 标准化违规提示（不暴露原因）
 *  - 超时 → "转换超时请重试"
 *  - 403 / 权限（CAM 未授权）→ "服务暂不可用"（日志留原错，便于管理员排查）
 *  - 其他 → "转换失败请重试"
 */
function normalizeError(err) {
  const msg = String((err && err.message) || (err && err.errMsg) || '');
  const code = String((err && err.code) || (err && err.statusCode) || '');
  const bucket = (msg + ' ' + code).toLowerCase();

  if (/rate_limit/.test(bucket)) {
    return { message: '今日 PDF 转换页数额度已用完，请明天再试', code: 'RateLimit' };
  }
  // CI 文档处理未开通（cos-nodejs-sdk 抛 FunctionNotEnabled，header x-errno:-10104）
  if (/functionnotenabled|not enabled|10104/.test(bucket)) {
    return { message: 'PDF 转图片服务尚未就绪，请稍后重试或联系管理员', code: 'CiNotEnabled' };
  }
  if (/nosuchkey|not exist|未就绪|未找到|404/.test(bucket)) {
    return { message: 'PDF 未就绪，请重新转换', code: 'PdfMissing' };
  }
  if (/请上传 pdf|格式异常|不是.*pdf/.test(bucket)) {
    return { message: msg || '请上传 PDF 文件', code: 'NotPdf' };
  }
  if (/过大|exceed|too large|20mb|超过限制/.test(bucket)) {
    return { message: 'PDF 过大，请压缩后重试（限 20MB）', code: 'TooLarge' };
  }
  if (/违规|illegal|86414|risk/.test(bucket)) {
    return { message: '文档可能包含违规内容，请更换后重试', code: 'Illegal' };
  }
  if (/超时|timeout|timed out/.test(bucket)) {
    return { message: 'PDF 转换超时，请重试', code: 'Timeout' };
  }
  if (/403|accessdenied|unauthorized|权限|授权|signature/.test(bucket)) {
    // 多为 CAM 未授权 / 密钥未开通 COS：对终端用户给通用文案，日志已留原错供管理员排查
    return { message: 'PDF 转图片服务暂不可用，请稍后重试', code: 'ServiceUnavailable' };
  }
  return { message: 'PDF 转换失败，请重试', code: 'Unknown' };
}
