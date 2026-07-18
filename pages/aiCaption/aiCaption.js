// pages/aiCaption/aiCaption.js
// AI 智能配文：选图 → 混元 VLM 看图 → 按平台生成 3 条可发布配文 → 一键复制
//
// 定位：aiCaption = 帮这张图配句话发出去（可发布文案，按平台口吻 + 话题标签）
// 区别于 aiDescribe = 看懂这张图（客观描述/解读，不面向发布）。
//
// 云函数返回约定（见 cloudfunctions/aiCaption/index.js）：
//   success:true  → captions[]，mock=true 表示示例文案（密钥未配置），另带 used/limit
//   success:false → error='rate_limit'（配额用完）或 error=服务异常文案

const analytics = require('../../utils/analytics');

Page({
  data: {
    imageSrc: '',
    fileID: '',
    captions: [],
    isMock: false,          // 云函数返回 mock 示例文案
    selectedPlatform: 'moments',
    selectedPlatformLabel: '朋友圈',
    platforms: [
      { value: 'moments', label: '朋友圈', icon: '👥' },
      { value: 'xiaohongshu', label: '小红书', icon: '📕' },
      { value: 'weibo', label: '微博', icon: '🎤' },
      { value: 'douyin', label: '抖音', icon: '🎵' }
    ],
    topic: '',
    loading: false,
    // 失败态
    hasError: false,
    errorType: '',          // '' | 'service' | 'rate_limit'
    errorMsg: '',
    // 配额
    used: 0,
    limit: 20,
    usedText: ''          // 顶层额度条文案 "今日已用 X/20 次"
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'aiCaption' });
    this.loadQuota();
  },

  /**
   * 查询今日已用额度（只读，不消耗）。进页面时调一次，让额度条提前可见。
   * mock 态（未配置密钥）不展示额度条。
   */
  async loadQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiCaption',
        data: { action: 'quota' }
      });
      const r = (res && res.result) || {};
      console.log('[aiCaption] quota 返回', r);
      if (r.success && !r.demo) {
        this.setData({
          usedText: buildUsedText(r.used, r.limit),
          used: r.used || 0,
          limit: r.limit || this.data.limit
        });
      }
    } catch (e) {
      console.warn('[aiCaption] 查询额度失败', e && (e.errMsg || e.message));
    }
  },

  chooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(res) {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        that.setData({
          imageSrc: tempFilePath,
          fileID: '',
          captions: [],
          isMock: false,
          hasError: false,
          errorType: '',
          errorMsg: ''
        });
        that.uploadImage(tempFilePath);
      }
    });
  },

  async uploadImage(filePath) {
    const that = this;
    // 内容安全：违规则拦截（已弹标准化提示，不暴露原因），并清掉已展示的图
    const { guardImage } = require('../../utils/content-check');
    if (!(await guardImage(filePath))) {
      this.setData({ imageSrc: '', fileID: '' });
      return;
    }
    wx.showLoading({ title: '上传中...', mask: true });
    const cloudPath = `aiCaption/${Date.now()}.jpg`;

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: res => {
        that.setData({ fileID: res.fileID });
        wx.hideLoading();
      },
      fail: err => {
        console.error('上传失败', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  selectPlatform(e) {
    const platform = e.currentTarget.dataset.platform;
    const platformLabel = this.data.platforms.find(p => p.value === platform).label;
    this.setData({
      selectedPlatform: platform,
      selectedPlatformLabel: platformLabel,
      captions: [],
      isMock: false,
      hasError: false,
      errorType: '',
      errorMsg: ''
    });
  },

  onTopicInput(e) {
    this.setData({ topic: e.detail.value });
  },

  /**
   * 生成配文（重试 / 换一批 共用此入口：同图同平台同主题重新调用）
   */
  async generateCaption() {
    if (!this.data.fileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }

    this.setData({
      loading: true,
      hasError: false,
      errorType: '',
      errorMsg: '',
      captions: []
    });
    wx.showLoading({ title: 'AI创作中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiCaption',
        data: {
          fileID: this.data.fileID,
          platform: this.data.selectedPlatform,
          topic: this.data.topic
        }
      });

      wx.hideLoading();
      const r = (res && res.result) || {};

      if (r.success) {
        this.setData({
          captions: Array.isArray(r.captions) ? r.captions : [],
          isMock: !!r.mock,
          used: r.used || 0,
          limit: r.limit || this.data.limit,
          usedText: r.mock ? '' : buildUsedText(r.used, r.limit)
        });
        analytics.track('tool_complete', { toolId: 'aiCaption' });
      } else if (r.error === 'rate_limit') {
        this.setData({
          hasError: true,
          errorType: 'rate_limit',
          errorMsg: `今日 ${r.limit || this.data.limit} 次配额已用完`,
          used: r.used || 0,
          limit: r.limit || this.data.limit,
          usedText: buildUsedText(r.used, r.limit),
          isMock: false
        });
      } else {
        this.setData({
          hasError: true,
          errorType: 'service',
          errorMsg: r.error || '生成失败，请稍后重试',
          isMock: false
        });
      }
    } catch (err) {
      console.error('调用失败', err);
      wx.hideLoading();
      this.setData({
        hasError: true,
        errorType: 'service',
        errorMsg: '网络异常，请稍后重试',
        isMock: false
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 失败态重试 */
  retry() {
    this.generateCaption();
  },

  /** 成功态「换一批」 */
  regenerate() {
    this.generateCaption();
  },

  copyCaption(e) {
    const caption = e.currentTarget.dataset.caption;
    if (!caption) return;
    wx.setClipboardData({
      data: caption,
      success() {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  onShareAppMessage() {
    analytics.trackShare('aiCaption', 'friend');
    return {
      title: 'AI 智能配文：看图一键生成朋友圈/小红书文案',
      path: '/pages/aiCaption/aiCaption'
    };
  },

  onShareTimeline() {
    analytics.trackShare('aiCaption', 'timeline');
    return { title: '发圈没文案？AI 看图帮你写配文' };
  }
});

/**
 * 构造今日额度文案。仅密钥可用时云函数才返回 used/limit；缺失/mock 则返回空串（不展示）。
 */
function buildUsedText(used, limit) {
  const u = Number(used);
  const l = Number(limit);
  if (!isFinite(u) || !isFinite(l) || l <= 0) return '';
  return `今日已用 ${u}/${l} 次`;
}
