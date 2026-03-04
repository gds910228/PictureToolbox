// pages/aiCaption/aiCaption.js
Page({
  data: {
    imageSrc: '',
    fileID: '',
    captions: [],
    selectedPlatform: 'moments',
    platforms: [
      { value: 'moments', label: '朋友圈', icon: '👥' },
      { value: 'xiaohongshu', label: '小红书', icon: '📕' },
      { value: 'weibo', label: '微博', icon: '🎤' },
      { value: 'douyin', label: '抖音', icon: '🎵' }
    ],
    topic: '',
    loading: false
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
          captions: []
        });
        that.uploadImage(tempFilePath);
      }
    });
  },

  uploadImage(filePath) {
    const that = this;
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
    this.setData({
      selectedPlatform: e.currentTarget.dataset.platform,
      captions: []
    });
  },

  onTopicInput(e) {
    this.setData({ topic: e.detail.value });
  },

  async generateCaption() {
    const that = this;
    if (!that.data.fileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }

    that.setData({ loading: true });
    wx.showLoading({ title: 'AI创作中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiCaption',
        data: {
          fileID: that.data.fileID,
          platform: that.data.selectedPlatform,
          topic: that.data.topic
        }
      });

      wx.hideLoading();
      if (res.result.success) {
        that.setData({ captions: res.result.captions });
      } else {
        wx.showToast({ title: '生成失败', icon: 'none' });
      }
    } catch (err) {
      console.error('调用失败', err);
      wx.hideLoading();
      wx.showToast({ title: '生成失败', icon: 'none' });
    } finally {
      that.setData({ loading: false });
    }
  },

  copyCaption(e) {
    const caption = e.currentTarget.dataset.caption;
    wx.setClipboardData({
      data: caption,
      success() {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  }
});
