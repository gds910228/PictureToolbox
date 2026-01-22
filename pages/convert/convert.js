// pages/convert/convert.js
const imageProcess = require('../../utils/image-process');

Page({
  data: {
    imageSrc: '',
    convertedSrc: '',
    showResult: false,
    converting: false,
    formats: ['jpg', 'png', 'webp', 'bmp'],
    formatsUpper: ['JPG', 'PNG', 'WebP', 'BMP'],
    formatsDesc: ['适合照片，体积小', '适合图标，支持透明', '适合网页，体积小', '位图格式'],
    selectedFormat: 'jpg',
    selectedFormatUpper: 'JPG',
    originalFormat: '',
    originalFormatUpper: '',
    actualFormat: '',
    actualFormatUpper: ''
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '格式转换'
    });
  },

  /**
   * 选择图片
   */
  async chooseImage() {
    try {
      const files = await imageProcess.chooseImage(1, ['original'], ['album', 'camera']);

      if (files && files.length > 0) {
        const filePath = files[0];
        const format = filePath.split('.').pop().toLowerCase();
        const formatUpper = format.toUpperCase();
        const selectedFormat = format === 'jpg' ? 'png' : 'jpg';

        this.setData({
          imageSrc: filePath,
          convertedSrc: '',
          showResult: false,
          originalFormat: format,
          originalFormatUpper: formatUpper,
          selectedFormat: selectedFormat,
          selectedFormatUpper: selectedFormat.toUpperCase()
        });
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
   * 选择目标格式
   */
  selectFormat(e) {
    const { format } = e.currentTarget.dataset;
    this.setData({
      selectedFormat: format,
      selectedFormatUpper: format.toUpperCase()
    });
  },

  /**
   * 开始转换
   */
  async startConvert() {
    if (!this.data.imageSrc) {
      wx.showToast({
        title: '请先选择图片',
        icon: 'none'
      });
      return;
    }

    this.setData({ converting: true });

    try {
      wx.showLoading({
        title: '转换中...',
        mask: true
      });

      // 转换格式
      const convertedPath = await imageProcess.convertImageFormat(
        this.data.imageSrc,
        this.data.selectedFormat
      );

      // 从转换后的文件路径中提取实际格式
      const actualFormat = convertedPath.split('.').pop().toLowerCase();
      const actualFormatUpper = actualFormat.toUpperCase();

      // 检查是否发生了格式回退
      if (actualFormat !== this.data.selectedFormat) {
        wx.showModal({
          title: '格式转换提示',
          content: `您选择的${this.data.selectedFormatUpper}格式在当前设备不支持，已自动转换为${actualFormatUpper}格式`,
          showCancel: false,
          confirmText: '我知道了'
        });
      }

      this.setData({
        convertedSrc: convertedPath,
        showResult: true,
        converting: false,
        actualFormat: actualFormat,
        actualFormatUpper: actualFormatUpper
      });

      wx.hideLoading();

      if (actualFormat === this.data.selectedFormat) {
        wx.showToast({
          title: '转换完成',
          icon: 'success'
        });
      }
    } catch (err) {
      console.error('转换失败', err);
      this.setData({ converting: false });
      wx.hideLoading();
      wx.showToast({
        title: err.message || '转换失败',
        icon: 'none',
        duration: 2500
      });
    }
  },

  /**
   * 保存图片
   */
  async saveImage() {
    if (!this.data.convertedSrc) {
      wx.showToast({
        title: '请先转换图片',
        icon: 'none'
      });
      return;
    }

    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.convertedSrc);
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
      title: '格式转换 - 图片工具箱',
      path: '/pages/convert/convert'
    };
  }
});
