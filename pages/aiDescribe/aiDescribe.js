// pages/aiDescribe/aiDescribe.js
// AI图片描述页面

Page({
  data: {
    imageSrc: '',
    fileID: '',
    description: '',
    selectedStyle: 'professional',
    styles: [
      { value: 'professional', label: '专业描述', icon: '📝' },
      { value: 'artistic', label: '诗意描述', icon: '🎨' },
      { value: 'detailed', label: '详细描述', icon: '🔍' },
      { value: 'social', label: '社交媒体', icon: '📱' }
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
          description: ''
        });

        // 上传到云存储
        that.uploadImage(tempFilePath);
      }
    });
  },

  /**
   * 上传图片到云存储
   */
  uploadImage(filePath) {
    const that = this;
    wx.showLoading({
      title: '上传中...',
      mask: true
    });

    const cloudPath = `aiDescribe/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: res => {
        console.log('上传成功', res.fileID);
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
      description: ''
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
          description: res.result.description
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
  },

  /**
   * 保存图片
   */
  saveImage() {
    if (!this.data.imageSrc) {
      return;
    }

    wx.saveImageToPhotosAlbum({
      filePath: this.data.imageSrc,
      success() {
        wx.showToast({
          title: '已保存',
          icon: 'success'
        });
      },
      fail(err) {
        console.error('保存失败', err);
        if (err.errMsg.includes('auth')) {
          wx.showModal({
            title: '提示',
            content: '需要您授权保存图片到相册',
            showCancel: false
          });
        }
      }
    });
  }
});
