// content-check.js（云函数侧，服务端内容安全兜底）
// canonical 源：cloudfunctionTemplate/content-check.js
// 每个需要兜底的云函数各持一份相同副本（微信云函数为隔离部署单元，无法跨目录 require）。
// 仅做图片 imgSecCheck；违规则抛错（由各函数既有 try/catch 捕获，返回标准化提示，不暴露原因）。
// 调用方需先 `cloud.init(...)`，并把 cloud 实例传入 assertImageSafe。

const IMG_RISK_CODE = 86414;            // imgSecCheck 内容违规业务码
const SIZE_LIMIT = 1 * 1024 * 1024;     // imgSecCheck 限制 ≤1MB

function _isImgSafe(r) {
  if (!r) return true;
  if (r.errCode && r.errCode !== 0) return false; // 86414 等
  if (r.result && r.result.suggest === 'risky') return false;
  if (Array.isArray(r.detail) && r.detail.some(d => d.suggest === 'risky')) return false;
  return true;
}

/**
 * 服务端图片内容安全兜底：
 *   buffer ≤1MB → 调 imgSecCheck，违规抛 Error('图片包含违规内容，请更换后重试')；
 *   >1MB       → 放行并记录（前端已对缩略图拦截为主，服务端无 sharp 降级）；
 *   API 异常（权限/限流/超时）→ 降级放行并记录。
 * @param {Buffer} imageBuffer
 * @param {object} cloud 已 cloud.init 的 wx-server-sdk 实例
 * @param {string} contentType 图片 MIME（默认 image/jpeg）
 */
async function assertImageSafe(imageBuffer, cloud, contentType) {
  if (!imageBuffer || !imageBuffer.length) return;
  if (imageBuffer.length > SIZE_LIMIT) {
    console.warn('[content-check] 图片过大跳过服务端兜底检测', imageBuffer.length);
    return;
  }
  let result;
  try {
    result = await cloud.openapi.security.imgSecCheck({
      media: { contentType: contentType || 'image/jpeg', value: imageBuffer }
    });
  } catch (e) {
    const code = e && e.errCode;
    if (code === IMG_RISK_CODE || (e && typeof e.errMsg === 'string' && /86414|risk/i.test(e.errMsg))) {
      throw new Error('图片包含违规内容，请更换后重试');
    }
    // 非业务码 → 服务端不阻断（前端已检测为主）
    console.error('[content-check] 服务端检测异常，降级放行', e && (e.errCode || e.message));
    return;
  }
  if (!_isImgSafe(result)) {
    throw new Error('图片包含违规内容，请更换后重试');
  }
}

module.exports = { assertImageSafe };
