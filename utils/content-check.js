// utils/content-check.js
// 内容安全前端工具：选图 / 输入文字后调用 checkImage 云函数（imgSecCheck / msgSecCheck，同步）。
// 违规 → 弹标准化提示（绝不暴露 label/具体原因）；检测服务异常 → 降级放行。
// 注意：对 image-process 采用函数内懒 require，避免与 image-process.chooseImage 之间的循环依赖死锁。

// 文案常量（统一维护，不含任何违规原因/label）
const VIOLATION_TIP_IMG = '图片可能包含违规内容，请更换后重试';
const VIOLATION_TIP_TEXT = '文字内容可能违规，请修改后重试';

// true：检测异常时放行（避免瞬时故障阻断正常用户）；false：异常即拦截
const FAIL_OPEN = true;

/**
 * 检测单张图片：缩图 → base64 → 云函数。返回布尔。
 * @param {string} filePath - 图片临时路径
 * @returns {Promise<boolean>}
 */
async function checkImage(filePath) {
  const makeCheckThumb = require('./image-process').makeCheckThumb;
  const thumb = await makeCheckThumb(filePath).catch(() => filePath);
  const fs = wx.getFileSystemManager();
  const base64 = fs.readFileSync(thumb, 'base64');
  const res = await wx.cloud.callFunction({
    name: 'checkImage',
    data: { mode: 'image', base64: base64, contentType: 'image/jpeg' }
  });
  const r = (res && res.result) || {};
  return !!r.safe;
}

/**
 * 检测一段文字。返回布尔。
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function checkText(text) {
  if (!text || !String(text).trim()) return true;
  const res = await wx.cloud.callFunction({
    name: 'checkImage',
    data: { mode: 'text', content: String(text).slice(0, 2500) }
  });
  const r = (res && res.result) || {};
  return !!r.safe;
}

/**
 * 图片守卫：检测 + 兜底。违规弹标准提示返回 false；通过返回 true；异常按 FAIL_OPEN。
 * @param {string} filePath
 * @returns {Promise<boolean>} true=可继续，false=已拦截
 */
async function guardImage(filePath) {
  try {
    const safe = await checkImage(filePath);
    if (!safe) {
      wx.showToast({ title: VIOLATION_TIP_IMG, icon: 'none', duration: 2500 });
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[内容安全] 图片检测异常，降级放行', e && (e.errMsg || e.message));
    return FAIL_OPEN;
  }
}

/**
 * 文字守卫：同上。
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function guardText(text) {
  try {
    const safe = await checkText(text);
    if (!safe) {
      wx.showToast({ title: VIOLATION_TIP_TEXT, icon: 'none', duration: 2500 });
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[内容安全] 文字检测异常，降级放行', e && (e.errMsg || e.message));
    return FAIL_OPEN;
  }
}

module.exports = {
  checkImage,
  checkText,
  guardImage,
  guardText,
  VIOLATION_TIP_IMG,
  VIOLATION_TIP_TEXT,
  FAIL_OPEN
};
