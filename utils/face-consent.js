// utils/face-consent.js
// AI 人像类功能（百变头像 / 风格迁移）的肖像权授权状态记忆。
//
// 背景：2026-10-25 版本审核驳回——"AI生成功能存在未授权公众人物人脸数据生成服务，
// 涉嫌肖像权及个人信息违规，请增加授权声明弹窗"。本模块配合 face-consent 弹窗组件：
// 用户点"同意并生成"后记录时间戳，7 天内不再弹（勾选"7 天内不再提示"时）。
//
// 约定：所有 AI 人像生成类功能共用一个授权 key（同一类合规承诺，避免多头弹窗）；
// 弹窗文案与数据行为（离开页面删除原图）见 components/face-consent/。

const KEY = 'face_gen_consent_at';
const TTL = 7 * 24 * 3600 * 1000;

/** 授权是否在有效期内（7 天） */
function isValid() {
  try {
    const ts = Number(wx.getStorageSync(KEY) || 0);
    return ts > 0 && (Date.now() - ts) < TTL;
  } catch (e) {
    return false;
  }
}

/** 记录用户同意（从当下起 7 天内免弹） */
function remember() {
  try {
    wx.setStorageSync(KEY, Date.now());
  } catch (e) { /* 存储异常不阻断主流程 */ }
}

/** 清除授权记忆（下次生成重新弹窗；预留设置入口用） */
function reset() {
  try {
    wx.removeStorageSync(KEY);
  } catch (e) { /* 静默 */ }
}

module.exports = { isValid, remember, reset, TTL_DAYS: 7 };
