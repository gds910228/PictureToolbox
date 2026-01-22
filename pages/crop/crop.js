// pages/crop/crop.js
const imageProcess = require('../../utils/image-process');

Page({
  data: {
    imageSrc: '',
    croppedSrc: '',
    showResult: false,
    cropping: false,
    showCustomRatio: false,
    customWidth: '',
    customHeight: '',
    cropMode: 'ratio', // 'ratio' 按比例裁剪, 'pixel' 按像素裁剪
    imageWidth: 0,
    imageHeight: 0,
    // 预设裁剪比例
    ratios: [
      { name: '1:1', value: 1, desc: '正方形' },
      { name: '4:3', value: 4/3, desc: '标准照片' },
      { name: '3:4', value: 3/4, desc: '竖版照片' },
      { name: '16:9', value: 16/9, desc: '宽屏视频' },
      { name: '9:16', value: 9/16, desc: '手机壁纸' },
      { name: '3:2', value: 3/2, desc: '经典胶片' },
      { name: '2:3', value: 2/3, desc: '竖版胶片' },
      { name: '5:4', value: 5/4, desc: '大画幅' },
      { name: '4:5', value: 4/5, desc: 'Instagram竖' },
      { name: '自由', value: 0, desc: '自定义比例' }
    ],
    selectedRatio: 0
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '图片裁剪'
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
        const info = await imageProcess.getImageInfo(filePath);

        this.setData({
          imageSrc: filePath,
          croppedSrc: '',
          showResult: false,
          imageWidth: info.width,
          imageHeight: info.height,
          customWidth: '',
          customHeight: '',
          cropMode: 'ratio',
          showCustomRatio: false,
          selectedRatio: 0
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
   * 切换裁剪模式
   */
  switchCropMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      cropMode: mode,
      showCustomRatio: false,
      customWidth: '',
      customHeight: ''
    });
  },

  /**
   * 选择裁剪比例
   */
  selectRatio(e) {
    const { index } = e.currentTarget.dataset;
    const selectedRatioData = this.data.ratios[index];

    this.setData({
      selectedRatio: index,
      showCustomRatio: selectedRatioData.value === 0
    });
  },

  /**
   * 输入自定义宽度
   */
  onWidthInput(e) {
    this.setData({
      customWidth: e.detail.value
    });
  },

  /**
   * 输入自定义高度
   */
  onHeightInput(e) {
    this.setData({
      customHeight: e.detail.value
    });
  },

  /**
   * 开始裁剪（简化版：使用预设比例）
   */
  async startCrop() {
    if (!this.data.imageSrc) {
      wx.showToast({
        title: '请先选择图片',
        icon: 'none'
      });
      return;
    }

    // 按比例裁剪模式
    if (this.data.cropMode === 'ratio') {
      // 检查是否选择了自由比例但未输入自定义比例
      const selectedRatioData = this.data.ratios[this.data.selectedRatio];
      if (selectedRatioData.value === 0) {
        if (!this.data.customWidth || !this.data.customHeight) {
          wx.showToast({
            title: '请输入自定义比例',
            icon: 'none'
          });
          return;
        }
        const width = parseInt(this.data.customWidth);
        const height = parseInt(this.data.customHeight);
        if (width <= 0 || height <= 0) {
          wx.showToast({
            title: '比例值必须大于0',
            icon: 'none'
          });
          return;
        }
      }
    } else {
      // 按像素裁剪模式
      if (!this.data.customWidth || !this.data.customHeight) {
        wx.showToast({
          title: '请输入裁剪尺寸',
          icon: 'none'
        });
        return;
      }
      const width = parseInt(this.data.customWidth);
      const height = parseInt(this.data.customHeight);
      if (width <= 0 || height <= 0) {
        wx.showToast({
          title: '尺寸必须大于0',
          icon: 'none'
        });
        return;
      }
      if (width > this.data.imageWidth || height > this.data.imageHeight) {
        wx.showToast({
          title: '尺寸超出原图范围',
          icon: 'none'
        });
        return;
      }
    }

    this.setData({ cropping: true });

    try {
      wx.showLoading({
        title: '裁剪中...',
        mask: true
      });

      // 获取图片信息
      const info = await imageProcess.getImageInfo(this.data.imageSrc);
      const { width, height } = info;

      let cropWidth, cropHeight, x, y;

      if (this.data.cropMode === 'ratio') {
        // 按比例裁剪
        let ratio = this.data.ratios[this.data.selectedRatio].value;

        // 如果是自定义比例，计算比例值
        if (ratio === 0) {
          ratio = parseInt(this.data.customWidth) / parseInt(this.data.customHeight);
        }

        if (width / height > ratio) {
          // 图片更宽，裁剪宽度
          cropHeight = height;
          cropWidth = height * ratio;
          x = (width - cropWidth) / 2;
          y = 0;
        } else {
          // 图片更高，裁剪高度
          cropWidth = width;
          cropHeight = width / ratio;
          x = 0;
          y = (height - cropHeight) / 2;
        }
      } else {
        // 按像素裁剪：从中心裁剪指定尺寸
        cropWidth = parseInt(this.data.customWidth);
        cropHeight = parseInt(this.data.customHeight);
        x = (width - cropWidth) / 2;
        y = (height - cropHeight) / 2;
      }

      // 执行裁剪
      const croppedPath = await imageProcess.cropImage(
        this.data.imageSrc,
        x, y, cropWidth, cropHeight
      );

      this.setData({
        croppedSrc: croppedPath,
        showResult: true,
        cropping: false
      });

      wx.hideLoading();
      wx.showToast({
        title: '裁剪完成',
        icon: 'success'
      });
    } catch (err) {
      console.error('裁剪失败', err);
      this.setData({ cropping: false });
      wx.hideLoading();
      wx.showToast({
        title: '裁剪失败',
        icon: 'none'
      });
    }
  },

  /**
   * 保存图片
   */
  async saveImage() {
    if (!this.data.croppedSrc) {
      wx.showToast({
        title: '请先裁剪图片',
        icon: 'none'
      });
      return;
    }

    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.croppedSrc);
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
      title: '图片裁剪 - 图片工具箱',
      path: '/pages/crop/crop'
    };
  }
});
