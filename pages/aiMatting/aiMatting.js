// pages/aiMatting/aiMatting.js
// AI智能抠图页面
const compareHelper = require('../../utils/compare-helper');

Page({
  data: {
    imageSrc: '',
    fileID: '',
    resultSrc: '',
    resultFileID: '',
    selectedType: 'auto',
    selectedTypeLabel: '智能识别',
    selectedBgColorLabel: '透明',
    types: [
      { value: 'auto', label: '智能识别', icon: '🤖', desc: '自动识别主体类型' },
      { value: 'portrait', label: '人像抠图', icon: '👤', desc: '优化人物边缘' },
      { value: 'product', label: '商品抠图', icon: '📦', desc: '适合电商商品' },
      { value: 'general', label: '通用抠图', icon: '✂️', desc: '适用于各种场景' }
    ],
    backgroundColors: [
      { name: '透明', value: 'transparent', color: '#f0f0f0' },
      { name: '白色', value: '#ffffff', color: '#ffffff' },
      { name: '黑色', value: '#000000', color: '#000000' },
      { name: '红色', value: '#ff4757', color: '#ff4757' },
      { name: '蓝色', value: '#1e90ff', color: '#1e90ff' },
      { name: '绿色', value: '#2ed573', color: '#2ed573' }
    ],
    selectedBgColor: 'transparent',
    loading: false,
    isRealMatting: false, // 是否真实抠图
    debugInfo: '' // 调试信息
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
          resultSrc: '',
          resultFileID: '',
          isRealMatting: false,
          debugInfo: ''
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
    const cloudPath = `aiMatting/${Date.now()}.jpg`;

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

  selectType(e) {
    const type = e.currentTarget.dataset.type;
    const selectedType = this.data.types.find(t => t.value === type);
    this.setData({
      selectedType: type,
      selectedTypeLabel: selectedType.label,
      resultSrc: '',
      resultFileID: '',
      isRealMatting: false
    });
  },

  selectBgColor(e) {
    const color = e.currentTarget.dataset.color;
    const selectedColor = this.data.backgroundColors.find(c => c.value === color);
    this.setData({
      selectedBgColor: color,
      selectedBgColorLabel: selectedColor.name
    });
  },

  async startMatting() {
    const that = this;
    if (!that.data.fileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }

    that.setData({ loading: true, debugInfo: '' });
    wx.showLoading({ title: 'AI抠图中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiMatting',
        data: {
          fileID: that.data.fileID,
          type: that.data.selectedType
        }
      });

      wx.hideLoading();

      console.log('云函数返回结果:', res);

      if (res.result.success) {
        const fileID = res.result.fileID;
        const recognition = res.result.recognition;
        const typeName = res.result.typeName;

        // 判断是否真实抠图
        const isRealMatting = fileID !== 'original' && fileID;

        that.setData({
          isRealMatting: isRealMatting,
          debugInfo: `fileID: ${fileID}, isRealMatting: ${isRealMatting}`
        });

        if (isRealMatting) {
          // 真实抠图成功
          wx.cloud.getTempFileURL({
            fileList: [fileID]
          }).then(urlRes => {
            console.log('获取临时URL成功:', urlRes);

            that.setData({
              resultSrc: urlRes.fileList[0].tempFileURL,
              resultFileID: fileID
            });

            wx.showModal({
              title: '✨ 抠图成功！',
              content: `真实抠图完成！\n\n已去除背景，生成透明PNG。\n\n当前背景：${that.getBgColorName()}`,
              showCancel: false,
              confirmText: '太棒了'
            });
          });
        } else {
          // 只是识别，没有真实抠图
          if (recognition) {
            let message = `✨ ${typeName}完成！\n\n`;
            message += `📷 AI识别结果：\n`;
            message += `• 主体类型：${that.getSubjectTypeName(recognition.subjectType)}\n`;
            message += `• 主体描述：${recognition.subjectDescription}\n`;
            message += `• 背景描述：${recognition.backgroundDescription}\n`;
            message += `• 置信度：${Math.round(recognition.confidence * 100)}%\n\n`;
            message += `⚠️ 提示：\n当前为智能识别模式（Beta版）。\n\n`;
            message += `真实抠图功能需要：\n`;
            message += `1. 开通腾讯云"人体分析"服务（已开通✓）\n`;
            message += `2. 查看云函数日志确认错误原因\n`;
            message += `3. 确保API密钥权限正确\n\n`;
            message += `是否查看调试信息？`;

            wx.showModal({
              title: 'AI智能识别成功',
              content: message,
              confirmText: '查看调试',
              cancelText: '我知道了',
              success(modalRes) {
                if (modalRes.confirm) {
                  // 显示调试信息
                  that.showDebugInfo();
                } else {
                  // 显示原图
                  that.setData({
                    resultSrc: that.data.imageSrc,
                    resultFileID: that.data.fileID
                  });
                }
              }
            });
          }
        }
      } else {
        wx.showToast({
          title: '抠图失败',
          icon: 'none',
          duration: 2000
        });
      }
    } catch (err) {
      console.error('调用失败', err);
      wx.hideLoading();

      // 显示详细错误
      let errorMsg = '处理失败\n\n';
      errorMsg += `错误信息：${err.message || err.errMsg || '未知错误'}\n\n`;
      errorMsg += `可能原因：\n`;
      errorMsg += `1. 人体分析服务未开通或权限不足\n`;
      errorMsg += `2. API密钥配置错误\n`;
      errorMsg += `3. 云函数未部署\n\n`;
      errorMsg += `建议：查看云函数日志获取详细错误信息`;

      wx.showModal({
        title: '处理失败',
        content: errorMsg,
        showCancel: false,
        confirmText: '我知道了'
      });
    } finally {
      that.setData({ loading: false });
    }
  },

  showDebugInfo() {
    const debugInfo = this.data.debugInfo || '无调试信息';
    const additionalInfo = `
调试信息：
${debugInfo}

当前模式：${this.data.isRealMatting ? '真实抠图' : '智能识别'}
选择的类型：${this.data.selectedType}

请查看云函数日志获取详细信息。
    `;

    wx.showModal({
      title: '调试信息',
      content: additionalInfo.trim(),
      showCancel: false
    });
  },

  getBgColorName() {
    const color = this.data.selectedBgColor;
    const colorMap = {
      'transparent': '透明',
      '#ffffff': '白色',
      '#000000': '黑色',
      '#ff4757': '红色',
      '#1e90ff': '蓝色',
      '#2ed573': '绿色'
    };
    return colorMap[color] || '透明';
  },

  getSubjectTypeName(type) {
    const types = {
      'person': '人物',
      'product': '商品',
      'animal': '动物',
      'other': '其他'
    };
    return types[type] || '未知';
  },

  saveResult() {
    if (!this.data.resultSrc) {
      wx.showToast({ title: '请先完成抠图', icon: 'none' });
      return;
    }

    wx.saveImageToPhotosAlbum({
      filePath: this.data.resultSrc,
      success() {
        wx.showToast({ title: '已保存', icon: 'success' });
      },
      fail(err) {
        console.error('保存失败', err);
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({
            title: '提示',
            content: '需要您授权保存图片到相册',
            showCancel: false
          });
        }
      }
    });
  },

  /**
   * 对比查看（原图 vs 抠图结果）
   */
  onCompare() {
    if (!this.data.imageSrc || !this.data.resultSrc) {
      wx.showToast({ title: '请先完成抠图', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.resultSrc, {
      title: '抠图对比'
    });
  },

  previewOriginalImage() {
    if (!this.data.imageSrc) return;
    wx.previewImage({
      current: this.data.imageSrc,
      urls: [this.data.imageSrc]
    });
  },

  previewResultImage() {
    if (!this.data.resultSrc) return;
    wx.previewImage({
      current: this.data.resultSrc,
      urls: [this.data.resultSrc]
    });
  }
});
