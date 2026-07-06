// pages/compress/compress.js
// 图片压缩：纯本地处理。智能压缩用 canvas 分析图像高频细节自适应质量（无 AI/云函数）。
const imageProcess = require('../../utils/image-process');
const compareHelper = require('../../utils/compare-helper');

// 本地图像类型 → 中文标签（智能压缩结果展示）
const IMAGE_TYPE_LABEL = {
  text: '文字/截图',
  portrait: '人像',
  landscape: '风景',
  other: '通用'
};

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
    imageTypeLabel: ''     // 智能压缩检测到的图像类型（本地分析）
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '图片压缩'
    });
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
   * 图片上传组件回调 - 图片列表变化
   * 由 image-uploader 组件触发
   */
  onImageChange(e) {
    const { paths, count } = e.detail;

    if (count === 0) {
      // 图片被清空，重置状态
      this.setData({
        imageSrc: '',
        originalSize: 0,
        originalSizeText: '',
        showResult: false,
        compressedSrc: '',
        imageTypeLabel: ''
      });
      return;
    }

    // 取第一张图的路径（单图模式）
    const filePath = paths[0];

    // 获取图片信息
    imageProcess.getImageInfo(filePath).then((info) => {
      // 获取实际文件大小
      return imageProcess.getFileSize(filePath).then(size => ({ info, size }));
    }).then(({ info, size }) => {
      const originalSizeText = this.formatFileSize(size);

      this.setData({
        imageSrc: filePath,
        originalSize: size,
        originalSizeText: originalSizeText,
        compressedSrc: '',
        showResult: false,
        imageTypeLabel: ''
      });
    }).catch((err) => {
      console.error('获取图片信息失败', err);
      wx.showToast({ title: '获取图片信息失败', icon: 'none' });
    });
  },

  /**
   * 图片上传组件错误回调
   */
  onImageError(e) {
    const { err, type } = e.detail;
    console.error('[compress] 图片上传组件错误', type, err);
    wx.showToast({ title: '选择图片失败', icon: 'none' });
  },

  /**
   * 继续选择（重新选择图片）
   * 清空组件后，用户点击上传区重新选择
   */
  chooseImage() {
    const uploader = this.selectComponent('#mainUploader');
    if (uploader && uploader.clear) {
      uploader.clear();
    }
    // 页面状态重置（组件 clear 后会触发 onImageChange 设置空状态）
    this.setData({
      imageSrc: '',
      compressedSrc: '',
      originalSize: 0,
      originalSizeText: '',
      showResult: false,
      imageTypeLabel: ''
    });
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
        // 智能压缩模式（本地 canvas 分析自适应质量）
        wx.showLoading({
          title: '智能分析中...',
          mask: true
        });

        const result = await imageProcess.smartCompressImage(
          this.data.imageSrc,
          this.data.targetSizeKB,
          (quality, attempt) => {
            wx.showLoading({
              title: `压缩中 ${attempt}/10...`,
              mask: true
            });
          }
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
          compressing: false,
          imageTypeLabel: IMAGE_TYPE_LABEL[result.imageType] || ''
        });

        wx.hideLoading();

        wx.showToast({
          title: `智能压缩完成 (质量${result.quality}%)`,
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
          compressing: false,
          imageTypeLabel: ''
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
   * 对比查看（原图 vs 压缩后）
   */
  onCompare() {
    if (!this.data.imageSrc || !this.data.compressedSrc) {
      wx.showToast({ title: '请先压缩图片', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.compressedSrc, {
      title: '压缩对比',
      showInfo: true
    });
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
