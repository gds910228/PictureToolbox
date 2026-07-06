// pages/aiDescribe/aiDescribe.js
// AI图片描述页面
//
// 定位：aiDescribe = 看懂这张图（客观描述/解读，输出一段描述图本身的话）
// 区别于 aiCaption = 帮这张图配句话发出去（可发布文案，按平台口吻 + 话题）。
// 本页 social 风格已移除（与 aiCaption 配文重叠）；社媒发布文案请用 aiCaption。

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
    loading: false
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
          isMock: !!res.result.isMock
        });
      } else {
        wx.showToast({
          title: '生成失败',
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('调用云函数失败', err);
      wx.hideLoading();
      wx.showToast({
        title: '生成失败',
        icon: 'none'
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
  }
});
