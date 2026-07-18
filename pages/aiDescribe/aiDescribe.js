// pages/aiDescribe/aiDescribe.js
// AI图片描述页面
//
// 定位：aiDescribe = 看懂这张图（客观描述/解读，输出一段描述图本身的话）
// 区别于 aiCaption = 帮这张图配句话发出去（可发布文案，按平台口吻 + 话题）。
// 本页 social 风格已移除（与 aiCaption 配文重叠）；社媒发布文案请用 aiCaption。

const analytics = require('../../utils/analytics');

Page({
  data: {
    imageSrc: '',
    fileID: '',
    description: '',
    isMock: false, // 云函数返回 mock 示例文案（未配置 AI 密钥）
    selectedStyle: 'professional',
    styles: [
      { value: 'professional', label: '专业描述', icon: '📝' },
      { value: 'artistic', label: '诗意描述', icon: '🎨' },
      { value: 'detailed', label: '详细描述', icon: '🔍' },
      { value: 'concise', label: '简洁概括', icon: '⚡' },
      { value: 'ecommerce', label: '电商推广', icon: '🛒' },
      { value: 'photography', label: '摄影点评', icon: '📷' },
      { value: 'emotional', label: '情感故事', icon: '💫' }
    ],
    loading: false,
    // 配额
    usedText: '',
    used: 0,
    limit: 20,
    // 失败态
    hasError: false,
    errorMsg: ''
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'aiDescribe' });
    this.loadQuota();
  },

  /**
   * 查询今日已用额度（只读，不消耗）。进页面时调一次，让额度条提前可见。
   * demo 态（未配置密钥）不展示额度条。
   */
  async loadQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiImageDescribe',
        data: { action: 'quota' }
      });
      const r = (res && res.result) || {};
      console.log('[aiDescribe] quota 返回', r);
      if (r.success && !r.demo) {
        this.setData({
          usedText: buildUsedText(r.used, r.limit),
          used: r.used || 0,
          limit: r.limit || this.data.limit
        });
      }
    } catch (e) {
      console.warn('[aiDescribe] 查询额度失败', e && (e.errMsg || e.message));
    }
  },

  /**
   * 选择图片
   */
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
          description: '',
          isMock: false
        });

        // 上传到云存储
        that.uploadImage(tempFilePath);
      }
    });
  },

  /**
   * 上传图片到云存储
   */
  async uploadImage(filePath) {
    const that = this;
    // 内容安全：违规则拦截（已弹标准化提示，不暴露原因），并清掉已展示的图
    const { guardImage } = require('../../utils/content-check');
    if (!(await guardImage(filePath))) {
      this.setData({ imageSrc: '', fileID: '' });
      return;
    }
    wx.showLoading({
      title: '上传中...',
      mask: true
    });

    const cloudPath = `aiDescribe/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: res => {
        that.setData({
          fileID: res.fileID
        });
        wx.hideLoading();
      },
      fail: err => {
        console.error('上传失败', err);
        wx.hideLoading();
        wx.showToast({
          title: '上传失败',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 选择描述风格
   */
  selectStyle(e) {
    const style = e.currentTarget.dataset.style;
    this.setData({
      selectedStyle: style,
      description: '',
      isMock: false
    });
  },

  /**
   * 生成描述
   */
  async generateDescription() {
    const that = this;

    if (!that.data.fileID && !that.data.imageSrc) {
      wx.showToast({
        title: '请先选择图片',
        icon: 'none'
      });
      return;
    }

    that.setData({
      loading: true
    });

    wx.showLoading({
      title: 'AI分析中...',
      mask: true
    });

    try {
      // 调用云函数
      const res = await wx.cloud.callFunction({
        name: 'aiImageDescribe',
        data: {
          fileID: that.data.fileID,
          style: that.data.selectedStyle
        }
      });

      wx.hideLoading();

      if (res.result.success) {
        that.setData({
          description: res.result.description,
          isMock: !!res.result.isMock,
          hasError: false,
          errorMsg: '',
          usedText: res.result.isMock ? '' : buildUsedText(res.result.used, res.result.limit),
          used: res.result.used || 0,
          limit: res.result.limit || that.data.limit
        });
        analytics.track('tool_complete', { toolId: 'aiDescribe' });
      } else if (res.result.error === 'rate_limit') {
        that.setData({
          hasError: true,
          errorMsg: `今日 ${res.result.limit || that.data.limit} 次额度已用完，次日 0 点重置`,
          usedText: buildUsedText(res.result.used, res.result.limit),
          used: res.result.used || 0,
          limit: res.result.limit || that.data.limit
        });
      } else {
        that.setData({
          hasError: true,
          errorMsg: res.result.error || '生成失败，请稍后重试'
        });
      }
    } catch (err) {
      console.error('调用云函数失败', err);
      wx.hideLoading();
      that.setData({
        hasError: true,
        errorMsg: '网络异常，请稍后重试'
      });
    } finally {
      that.setData({
        loading: false
      });
    }
  },

  /**
   * 复制描述
   */
  copyDescription() {
    if (!this.data.description) {
      return;
    }

    wx.setClipboardData({
      data: this.data.description,
      success() {
        wx.showToast({
          title: '已复制',
          icon: 'success'
        });
      }
    });
  },

  /** 失败态重试 */
  retry() {
    this.generateDescription();
  },

  onShareAppMessage() {
    analytics.trackShare('aiDescribe', 'friend');
    return {
      title: 'AI 图片描述：7 种风格看懂画面内容',
      path: '/pages/aiDescribe/aiDescribe'
    };
  },

  onShareTimeline() {
    analytics.trackShare('aiDescribe', 'timeline');
    return { title: '让 AI 帮你看懂一张图，7 种风格描述' };
  }
});

/**
 * 构造今日额度文案。仅密钥可用时云函数才返回 used/limit；缺失/demo 则返回空串（不展示）。
 */
function buildUsedText(used, limit) {
  const u = Number(used);
  const l = Number(limit);
  if (!isFinite(u) || !isFinite(l) || l <= 0) return '';
  return `今日已用 ${u}/${l} 次`;
}
