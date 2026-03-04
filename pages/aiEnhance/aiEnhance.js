// pages/aiEnhance/aiEnhance.js
Page({
  data: {
    imageSrc: '',
    originalFileID: '',
    enhancedFileID: '',
    enhancedSrc: '',
    selectedType: 'upscale',
    types: [
      { value: 'upscale', label: '超分辨率', icon: '🔍', desc: '2倍放大' },
      { value: 'denoise', label: '智能降噪', icon: '✨', desc: '去除噪点' },
      { value: 'sharpen', label: '清晰化', icon: '💎', desc: '增强细节' }
    ],
    loading: false
  },

  chooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(res) {
        that.setData({
          imageSrc: res.tempFiles[0].tempFilePath,
          originalFileID: '',
          enhancedFileID: '',
          enhancedSrc: ''
        });
        that.uploadImage(res.tempFiles[0].tempFilePath);
      }
    });
  },

  uploadImage(filePath) {
    const that = this;
    wx.showLoading({ title: '上传中...', mask: true });
    const cloudPath = `aiEnhance/${Date.now()}.jpg`;

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: res => {
        that.setData({ originalFileID: res.fileID });
        wx.hideLoading();
      },
      fail: err => {
        console.error('上传失败', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  selectType(e) {
    this.setData({
      selectedType: e.currentTarget.dataset.type,
      enhancedFileID: '',
      enhancedSrc: ''
    });
  },

  async enhanceImage() {
    const that = this;
    if (!that.data.originalFileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }

    that.setData({ loading: true });
    wx.showLoading({ title: 'AI增强中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiImageEnhance',
        data: {
          fileID: that.data.originalFileID,
          type: that.data.selectedType
        }
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
        }

        // 显示增强后的图片
        wx.cloud.getTempFileURL({
          fileList: [res.result.fileID]
        }).then(urlRes => {
          that.setData({
            enhancedFileID: res.result.fileID,
            enhancedSrc: urlRes.fileList[0].tempFileURL
          });
        });
      } else {
        wx.showToast({ title: '增强失败', icon: 'none' });
      }
    } catch (err) {
      console.error('调用失败', err);
      wx.hideLoading();
      wx.showToast({ title: '增强失败', icon: 'none' });
    } finally {
      that.setData({ loading: false });
    }
  },

  saveEnhanced() {
    if (!this.data.enhancedSrc) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.enhancedSrc,
      success() {
        wx.showToast({ title: '已保存', icon: 'success' });
      }
    });
  }
});
