// utils/analytics.js
// 轻量埋点工具（P0 流量可观测地基）。
//
// 设计：
//   - 优先用微信官方 wx.reportEvent 上报（需在「公众平台->数据分析->自定义事件」登记事件名）；
//   - 未登记或上报失败时兜底 console.log，绝不抛错、不阻断业务。
//   - 所有事件附带 appId 无关的通用字段：scene（来源场景码）、ts（时间戳）。
//
// scene 来源码（wx.getEnterOptionsSync().scene 常见值，供来源分析）：
//   1001 发现栏小程序入口/搜索  1007 单聊分享  1008 群聊分享
//   1011 扫一扫  1023 聊天顶部  1035 公众号自定义菜单  1047 扫描小程序码
//   1053 搜一搜的结果页  1089 微信聊天主界面下拉  1131 浮窗  1145 朋友圈单页
//
// 用法：
//   const { track, trackShare } = require('../../utils/analytics');
//   track('tool_view', { toolId: 'aiMatting' });
//   track('tool_complete', { toolId: 'aiMatting' });
//   trackShare('aiMatting', 'friend');

let _scene = null; // 启动场景码，app.js 注入一次，各页复用

/**
 * 注入启动场景码（app.js onLaunch 调一次）。
 */
function initScene() {
  try {
    const opt = wx.getEnterOptionsSync && wx.getEnterOptionsSync();
    _scene = (opt && opt.scene) || null;
  } catch (e) {
    _scene = null;
  }
  return _scene;
}

/**
 * 读取已注入的启动场景码。
 */
function getScene() {
  return _scene;
}

/**
 * 通用事件上报。
 * @param {string} name 事件名（需在公众平台「自定义事件」登记）
 * @param {Object} data 业务字段
 */
function track(name, data) {
  const payload = Object.assign({ scene: _scene }, data || {});
  try {
    if (wx.reportEvent) {
      wx.reportEvent(name, payload);
    }
  } catch (e) {
    // 兜底：事件未登记/接口异常 -> 不阻断
  }
  // 开发可见（不影响线上）
  console.log('[analytics]', name, payload);
}

/**
 * 分享点击上报（统一入口）。
 * @param {string} from 来源页 toolId
 * @param {string} channel 'friend' | 'timeline'
 */
function trackShare(from, channel) {
  track('share_click', { from: from, channel: channel });
}

module.exports = {
  initScene,
  getScene,
  track,
  trackShare
};
