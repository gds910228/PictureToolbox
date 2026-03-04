// pages/aiStyle/aiStyle.js
Page({
  data: {
    imageSrc: '',
    fileID: '',
    resultSrc: '',
    selectedStyle: 'oil-painting',
    styles: [
      { value: 'oil-painting', label: '油画', icon: '🎨' },
      { value: 'watercolor', label: '水彩', icon: '💧' },
      { value: 'sketch', label: '素描', icon: '✏️' },
      { value: 'anime', label: '动漫', icon: '🎌' },
      { value: 'cyberpunk', label: '赛博朋克', icon: '🌃' },
      { value: 'pop-art', label: '波普艺术', icon: '🎭' }
    ],
    loading: false
  },

  chooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success(res) {
        that.setData({ imageSrc: res.tempFiles[0].tempFilePath, fileID: '', resultSrc: '' });
        that.uploadImage(res.tempFiles[0].tempFilePath);
      }
    });
  },

  uploadImage(filePath) {
    const that = this;
    wx.showLoading({ title: '上传中...' });
    wx.cloud.uploadFile({
      cloudPath: `aiStyle/${Date.now()}.jpg`,
      filePath: filePath,
      success: res => {
        that.setData({ fileID: res.fileID });
        wx.hideLoading();
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }); }
    });
  },

  selectStyle(e) {
    this.setData({ selectedStyle: e.currentTarget.dataset.style, resultSrc: '' });
  },

  async transferStyle() {
    const that = this;
    if (!that.data.fileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    that.setData({ loading: true });
    wx.showLoading({ title: '风格迁移中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiStyleTransfer',
        data: { fileID: that.data.fileID, style: that.data.selectedStyle }
      });
      wx.hideLoading();
      if (res.result.success) {
        // 如果有提示消息，显示给用户
        if (res.result.message) {
          wx.showToast({
            title: res.result.message,
            icon: 'none',
            duration: 3000
          });
        } else {
          wx.showToast({ title: '转换成功', icon: 'success' });
        }
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '转换失败', icon: 'none' });
    } finally {
      that.setData({ loading: false });
    }
  }
});
