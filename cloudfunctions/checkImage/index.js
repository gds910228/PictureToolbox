// cloudfunctions/checkImage/index.js
// 内容安全检测云函数（同步）：
//   图片 security.imgSecCheck（≤1MB / ≤750×1334px，前端须先缩图）
//   文字 security.msgSecCheck
// 安全约定：只返回 { safe: true/false }（外加 degraded/skipped 标记），
//           绝不返回 label / detail / keyword / 具体违规原因，满足审核"仅提示含违规信息"。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// true：检测服务异常（权限/限流/超时）时降级放行，避免瞬时故障阻断正常用户；
// false：异常即拦截（更严格，但接口抖动会让全员无法上传）。
const FAIL_OPEN = true;

// 业务风险码（属"内容违规"判定，非服务异常）：imgSecCheck=86414，msgSecCheck=87013
const IMG_RISK_CODE = 86414;
const TEXT_RISK_CODE = 87013;

function _isImgSafe(r) {
  if (!r) return true;
  if (r.errCode && r.errCode !== 0) return false; // 86414 等
  if (r.result && r.result.suggest === 'risky') return false;
  if (Array.isArray(r.detail) && r.detail.some(d => d.suggest === 'risky')) return false;
  return true;
}

function _isTextSafe(r) {
  if (!r) return true;
  if (r.errCode === TEXT_RISK_CODE) return false;
  if (r.result && r.result.suggest === 'risky') return false;
  if (Array.isArray(r.detail) && r.detail.some(d => d.suggest === 'risky')) return false;
  return true;
}

// 把抛出的异常归类：业务风险码 → 不安全；其它 → 服务异常（交上层 fail-open）
function _classifyImgError(e) {
  const code = e && e.errCode;
  if (code === IMG_RISK_CODE) return { safe: false };
  if (e && typeof e.errMsg === 'string' && /86414|risk/i.test(e.errMsg)) return { safe: false };
  return null;
}
function _classifyTextError(e) {
  const code = e && e.errCode;
  if (code === TEXT_RISK_CODE) return { safe: false };
  if (e && typeof e.errMsg === 'string' && /87013|risk/i.test(e.errMsg)) return { safe: false };
  return null;
}

exports.main = async (event, context) => {
  const { mode, base64, contentType, content } = event || {};

  try {
    if (mode === 'text') {
      if (!content || !String(content).trim()) return { safe: true };
      const { OPENID } = cloud.getWXContext();
      let result;
      try {
        result = await cloud.openapi.security.msgSecCheck({
          content: String(content).slice(0, 2500),
          scene: 1,
          version: 2,
          openid: OPENID
        });
      } catch (e) {
        const c = _classifyTextError(e);
        if (c) return { safe: c.safe };
        throw e;
      }
      return { safe: _isTextSafe(result) };
    }

    // 默认：图片检测
    if (!base64) return { safe: false, reason: 'no_image' };
    const buf = Buffer.from(base64, 'base64');
    // imgSecCheck 限制 ≤1MB；超大应由前端缩图，此处兜底降级放行并记录
    if (buf.length > 1 * 1024 * 1024) {
      console.warn('[checkImage] 图片过大跳过同步检测，应在前端缩图后送检', buf.length);
      return { safe: true, skipped: true };
    }
    let result;
    try {
      result = await cloud.openapi.security.imgSecCheck({
        media: { contentType: contentType || 'image/jpeg', value: buf }
      });
    } catch (e) {
      const c = _classifyImgError(e);
      if (c) return { safe: c.safe };
      throw e;
    }
    return { safe: _isImgSafe(result) };
  } catch (err) {
    // 检测服务本身异常（权限/限流/超时）：按 FAIL_OPEN 决定，不弹具体原因
    console.error('[checkImage] 检测异常，FAIL_OPEN=' + FAIL_OPEN, err && (err.errCode || err.message));
    return FAIL_OPEN ? { safe: true, degraded: true } : { safe: false, degraded: true };
  }
};
