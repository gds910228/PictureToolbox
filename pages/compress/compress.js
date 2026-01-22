// pages/compress/compress.js
const imageProcess = require('../../utils/image-process');

Page({
  data: {
    imageSrc: '',          // 原图片路径
    compressedSrc: '',     // 压缩后的图片路径
    originalSize: 0,       // 原图大小
    compressedSize: 0,     // 压缩后大小
    originalSizeText: '',  // 原图大小文本
    compressedSizeText: '',// 压缩后大小文本
    compressionRate: '',   // 压缩率
    quality: 80,           // 压缩质量
    showResult: false,     // 是否显示结果
    compressing: false,    // 是否正在压缩
    useSmartCompress: false, // 是否使用智能压缩
    targetSizeKB: 0,       // 目标文件大小（KB）

    // AI分析相关
    aiAnalysis: null,      // AI分析结果
    analyzing: false,      // 是否正在分析
    showAIRecommendation: false, // 是否显示AI建议
    cloudEnabled: false    // 云开发是否已启用
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '图片压缩'
    });

    // 初始化云开发
    if (wx.cloud) {
      try {
        wx.cloud.init({
          env: 'cloud1-1gk79pjqd5e1ed35', // 你的云环境ID
          traceUser: true
        });
        console.log('云开发初始化成功');

        // 检查云开发是否可用
        this.setData({
          cloudEnabled: true
        });
      } catch (e) {
        console.error('云开发初始化失败', e);
        this.setData({
          cloudEnabled: false
        });
      }
    } else {
      console.warn('当前微信版本不支持云开发');
      this.setData({
        cloudEnabled: false
      });
    }
  },

  /**
   * 格式化文件大小
   */
  formatFileSize(size) {
    if (size / 1024 / 1024 > 1) {
      return (size / 1024 / 1024).toFixed(2) + ' MB';
    } else {
      return (size / 1024).toFixed(2) + ' KB';
    }
  },

  /**
   * 选择图片
   */
  async chooseImage() {
    try {
      const files = await imageProcess.chooseImage(1, ['original'], ['album', 'camera']);

      if (files && files.length > 0) {
        const filePath = files[0];

        // 获取图片信息
        const info = await imageProcess.getImageInfo(filePath);

        // 获取实际文件大小
        const originalSize = await imageProcess.getFileSize(filePath);
        const originalSizeText = this.formatFileSize(originalSize);

        this.setData({
          imageSrc: filePath,
          compressedSrc: '',
          originalSize: originalSize,
          originalSizeText: originalSizeText,
          compressedSize: 0,
          compressedSizeText: '',
          compressionRate: '',
          showResult: false,
          aiAnalysis: null,
          showAIRecommendation: false
        });

        // 仅在云开发已配置时进行AI分析
        if (this.data.cloudEnabled) {
          // 延迟执行，避免阻塞UI
          setTimeout(() => {
            this.analyzeImageWithAI(filePath);
          }, 100);
        }
      }
    } catch (err) {
      console.error('选择图片失败', err);
      wx.showToast({
        title: '选择图片失败',
        icon: 'none'
      });
    }
  },

  /**
   * 使用AI分析图片
   */
  async analyzeImageWithAI(filePath) {
    if (!this.data.cloudEnabled) {
      console.log('云开发未启用，跳过AI分析');
      return;
    }

    this.setData({
      analyzing: true
    });

    try {
      wx.showLoading({
        title: 'AI分析中...',
        mask: true
      });

      // 先上传图片到云存储
      const cloudPath = `compress/${Date.now()}-${Math.random().toString(36).substr(2)}.jpg`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: filePath
      });

      const fileID = uploadRes.fileID;

      // 调用云函数分析图片
      const analysisRes = await wx.cloud.callFunction({
        name: 'analyzeImage',
        data: {
          fileID: fileID
        }
      });

      wx.hideLoading();

      if (analysisRes.result && analysisRes.result.success) {
        const aiResult = analysisRes.result;

        // 自动应用AI推荐的质量
        this.setData({
          aiAnalysis: aiResult,
          showAIRecommendation: true,
          quality: aiResult.recommendation.suggestedQuality,
          analyzing: false
        });

        // 显示AI建议
        wx.showModal({
          title: 'AI分析结果',
          content: `${aiResult.recommendation.reason}\n\n建议质量: ${aiResult.recommendation.suggestedQuality}%\n\n${aiResult.recommendation.tips}`,
          showCancel: false,
          confirmText: '应用建议'
        });
      } else {
        // AI分析失败，使用默认策略
        this.setData({
          analyzing: false
        });
        wx.showToast({
          title: 'AI分析失败，使用默认策略',
          icon: 'none',
          duration: 2000
        });
      }
    } catch (err) {
      console.error('AI分析失败', err);
      this.setData({
        analyzing: false,
        cloudEnabled: false // 云开发配置有问题，自动禁用
      });
      wx.hideLoading();

      // 更友好的错误提示
      let errorMsg = 'AI分析失败';
      if (err.errMsg && err.errMsg.includes('INVALID_ENV')) {
        errorMsg = '云开发环境未配置，已自动切换到普通压缩模式';
      }

      wx.showToast({
        title: errorMsg,
        icon: 'none',
        duration: 2500
      });
    }
  },

  /**
   * 应用AI推荐的质量
   */
  applyAIRecommendation() {
    if (this.data.aiAnalysis && this.data.aiAnalysis.recommendation) {
      this.setData({
        quality: this.data.aiAnalysis.recommendation.suggestedQuality,
        useSmartCompress: true
      });
      wx.showToast({
        title: '已应用AI建议',
        icon: 'success'
      });
    }
  },

  /**
   * 滑动条变化
   */
  onSliderChange(e) {
    this.setData({
      quality: e.detail.value
    });
  },

  /**
   * 切换智能压缩
   */
  toggleSmartCompress(e) {
    this.setData({
      useSmartCompress: e.detail.value
    });
  },

  /**
   * 输入目标大小
   */
  onTargetSizeInput(e) {
    this.setData({
      targetSizeKB: parseInt(e.detail.value) || 0
    });
  },

  /**
   * 开始压缩
   */
  async startCompress() {
    if (!this.data.imageSrc) {
      wx.showToast({
        title: '请先选择图片',
        icon: 'none'
      });
      return;
    }

    this.setData({ compressing: true });

    try {
      if (this.data.useSmartCompress) {
        // 智能压缩模式
        wx.showLoading({
          title: '智能压缩中...',
          mask: true
        });

        // 传入AI分析结果（如果有）
        const result = await imageProcess.smartCompressImage(
          this.data.imageSrc,
          this.data.targetSizeKB,
          (quality, attempt) => {
            wx.showLoading({
              title: `压缩中 ${attempt}/7...`,
              mask: true
            });
          },
          this.data.aiAnalysis // 传入AI分析结果
        );

        const compressedSizeText = this.formatFileSize(result.size);
        const compressionRate = ((1 - result.size / this.data.originalSize) * 100).toFixed(1) + '%';

        this.setData({
          compressedSrc: result.path,
          compressedSize: result.size,
          compressedSizeText: compressedSizeText,
          compressionRate: compressionRate,
          quality: result.quality,
          showResult: true,
          compressing: false
        });

        wx.hideLoading();

        // 根据使用的策略显示不同的提示
        let strategyText = '压缩完成';
        if (this.data.aiAnalysis && this.data.aiAnalysis.recommendation) {
          const strategy = this.data.aiAnalysis.recommendation.strategy;
          if (strategy === 'quality-priority') {
            strategyText = 'AI质量优先压缩完成';
          } else if (strategy === 'size-priority') {
            strategyText = 'AI大小优先压缩完成';
          } else {
            strategyText = 'AI平衡压缩完成';
          }
        }

        wx.showToast({
          title: `${strategyText} (质量${result.quality}%)`,
          icon: 'success'
        });
      } else {
        // 普通压缩模式
        wx.showLoading({
          title: '压缩中...',
          mask: true
        });

        // 压缩图片
        const compressedPath = await imageProcess.compressImage(this.data.imageSrc, this.data.quality);

        // 获取压缩后的实际文件大小
        const compressedSize = await imageProcess.getFileSize(compressedPath);
        const compressedSizeText = this.formatFileSize(compressedSize);
        const compressionRate = ((1 - compressedSize / this.data.originalSize) * 100).toFixed(1) + '%';

        this.setData({
          compressedSrc: compressedPath,
          compressedSize: compressedSize,
          compressedSizeText: compressedSizeText,
          compressionRate: compressionRate,
          showResult: true,
          compressing: false
        });

        wx.hideLoading();

        wx.showToast({
          title: '压缩完成',
          icon: 'success'
        });
      }
    } catch (err) {
      console.error('压缩失败', err);
      this.setData({ compressing: false });
      wx.hideLoading();
      wx.showToast({
        title: '压缩失败',
        icon: 'none'
      });
    }
  },

  /**
   * 保存图片
   */
  async saveImage() {
    if (!this.data.compressedSrc) {
      wx.showToast({
        title: '请先压缩图片',
        icon: 'none'
      });
      return;
    }

    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.compressedSrc);
    } catch (err) {
      console.error('保存失败', err);
    }
  },

  /**
   * 预览图片
   */
  previewImage(e) {
    const { url } = e.currentTarget.dataset;
    wx.previewImage({
      current: url,
      urls: [url]
    });
  },

  /**
   * 分享
   */
  onShareAppMessage() {
    return {
      title: '图片压缩 - 图片工具箱',
      path: '/pages/compress/compress'
    };
  }
});
