// content-check.js（云函数侧，服务端内容安全兜底）
// canonical 源：cloudfunctionTemplate/content-check.js
// 仅做图片 imgSecCheck；违规则抛错。

const IMG_RISK_CODE = 86414;
const SIZE_LIMIT = 1 * 1024 * 1024;

function _isImgSafe(r) {
  if (!r) return true;
  if (r.errCode && r.errCode !== 0) return false;
  if (r.result && r.result.suggest === 'risky') return false;
  if (Array.isArray(r.detail) && r.detail.some(d => d.suggest === 'risky')) return false;
  return true;
}

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
    console.error('[content-check] 服务端检测异常，降级放行', e && (e.errCode || e.message));
    return;
  }
  if (!_isImgSafe(result)) {
    throw new Error('图片包含违规内容，请更换后重试');
  }
}

module.exports = { assertImageSafe };
