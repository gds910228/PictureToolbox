// pages/watermark/watermark.js
const imageProcess = require('../../utils/image-process');
const compareHelper = require('../../utils/compare-helper');
const analytics = require('../../utils/analytics');

Page({
  data: {
    imageSrc: '',
    processedSrc: '',
    showResult: false,
    processing: false,

    // 水印类型：text-文字水印, image-图片水印
    watermarkType: 'text',

    // 水印模式：single-单位置, multi-多位置, tile-平铺, diagonal-对角线
    watermarkMode: 'single',

    // 文字水印参数
    watermarkText: '图片工具箱',
    fontSize: 24,
    fontColor: '#FFFFFF',
    opacity: 0.7,
    position: 9, // 1-9位置，9代表右下角
    selectedPositions: [], // 多位置模式选中的位置

    // 平铺模式参数
    tileSpacing: 150, // 平铺间距
    tileRotation: -30, // 旋转角度（度）
    tileDiagonal: false, // 对角平铺

    // 图片水印参数
    watermarkImage: '',
    imageScale: 20, // 图片水印缩放比例

    // 位置映射
    positionMap: [
      { x: 0.1, y: 0.1 },   // 1: 左上
      { x: 0.5, y: 0.1 },   // 2: 上中
      { x: 0.9, y: 0.1 },   // 3: 右上
      { x: 0.1, y: 0.5 },   // 4: 左中
      { x: 0.5, y: 0.5 },   // 5: 正中
      { x: 0.9, y: 0.5 },   // 6: 右中
      { x: 0.1, y: 0.9 },   // 7: 左下
      { x: 0.5, y: 0.9 },   // 8: 中下
      { x: 0.9, y: 0.9 }    // 9: 右下
    ],

    // 计算位置单元格的class
    positionClass1: '',
    positionClass2: '',
    positionClass3: '',
    positionClass4: '',
    positionClass5: '',
    positionClass6: '',
    positionClass7: '',
    positionClass8: '',
    positionClass9: ''
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'watermark' });
  },

  /**
   * 更新位置单元格的class
   */
  updatePositionClasses() {
    const classes = {};

    for (let i = 1; i <= 9; i++) {
      let isActive = false;

      if (this.data.watermarkMode === 'single') {
        // 单位置模式
        isActive = this.data.position === i;
      } else if (this.data.watermarkMode === 'multi') {
        // 多位置模式
        isActive = this.data.selectedPositions.indexOf(i) > -1;
      }

      classes[`positionClass${i}`] = isActive ? 'active' : '';
    }

    this.setData(classes);
  },

  /**
   * 选择图片
   */
  async chooseImage() {
    try {
      const files = await imageProcess.chooseImage(1, ['original'], ['album', 'camera']);

      if (files && files.length > 0) {
        const filePath = files[0];

        this.setData({
          imageSrc: filePath,
          processedSrc: '',
          showResult: false,
          watermarkText: '图片工具箱',
          fontSize: 24,
          fontColor: '#FFFFFF',
          opacity: 0.7,
          position: 9,
          selectedPositions: []
        });
        this.updatePositionClasses();
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
   * 切换水印类型
   */
  switchWatermarkType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      watermarkType: type,
      processedSrc: '',
      showResult: false
    });
  },

  /**
   * 输入水印文字
   */
  onWatermarkTextInput(e) {
    this.setData({
      watermarkText: e.detail.value
    });
  },

  /**
   * 字体大小改变
   */
  onFontSizeChange(e) {
    this.setData({
      fontSize: parseInt(e.detail.value)
    });
  },

  /**
   * 颜色选择
   */
  onColorChange(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({
      fontColor: color
    });
  },

  /**
   * 透明度改变
   */
  onOpacityChange(e) {
    this.setData({
      opacity: parseFloat(e.detail.value) / 100
    });
  },

  /**
   * 切换水印模式
   */
  switchWatermarkMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      watermarkMode: mode,
      selectedPositions: [],
      processedSrc: '',
      showResult: false
    });
    this.updatePositionClasses();
  },

  /**
   * 位置选择
   */
  selectPosition(e) {
    const position = parseInt(e.currentTarget.dataset.position);

    if (this.data.watermarkMode === 'single') {
      // 单位置模式
      this.setData({
        position: position
      });
    } else if (this.data.watermarkMode === 'multi') {
      // 多位置模式
      const positions = this.data.selectedPositions;
      const index = positions.indexOf(position);

      if (index > -1) {
        // 已选中，取消选中
        positions.splice(index, 1);
      } else {
        // 未选中，添加到选中列表
        if (positions.length < 9) {
          positions.push(position);
        } else {
          wx.showToast({
            title: '最多选择9个位置',
            icon: 'none'
          });
          return;
        }
      }

      this.setData({
        selectedPositions: positions
      });
    }

    this.updatePositionClasses();
  },

  /**
   * 平铺间距改变
   */
  onTileSpacingChange(e) {
    this.setData({
      tileSpacing: parseInt(e.detail.value)
    });
  },

  /**
   * 平铺旋转角度改变
   */
  onTileRotationChange(e) {
    this.setData({
      tileRotation: parseInt(e.detail.value)
    });
  },

  /**
   * 选择水印图片
   */
  async chooseWatermarkImage() {
    try {
      const files = await imageProcess.chooseImage(1, ['original'], ['album']);

      if (files && files.length > 0) {
        this.setData({
          watermarkImage: files[0]
        });
      }
    } catch (err) {
      console.error('选择水印图片失败', err);
      wx.showToast({
        title: '选择失败',
        icon: 'none'
      });
    }
  },

  /**
   * 图片缩放改变
   */
  onImageScaleChange(e) {
    this.setData({
      imageScale: parseInt(e.detail.value)
    });
  },

  /**
   * 开始添加水印
   */
  async startAddWatermark() {
    if (!this.data.imageSrc) {
      wx.showToast({
        title: '请先选择图片',
        icon: 'none'
      });
      return;
    }

    // 文字水印验证
    if (this.data.watermarkType === 'text' && !this.data.watermarkText) {
      wx.showToast({
        title: '请输入水印文字',
        icon: 'none'
      });
      return;
    }

    // 内容安全：文字水印过检（违规则拦截，已弹标准化提示，不暴露原因）
    if (this.data.watermarkType === 'text') {
      const { guardText } = require('../../utils/content-check');
      if (!(await guardText(this.data.watermarkText))) {
        return;
      }
    }

    // 图片水印验证
    if (this.data.watermarkType === 'image' && !this.data.watermarkImage) {
      wx.showToast({
        title: '请选择水印图片',
        icon: 'none'
      });
      return;
    }

    // 多位置模式验证
    if (this.data.watermarkMode === 'multi' && this.data.selectedPositions.length === 0) {
      wx.showToast({
        title: '请至少选择1个位置',
        icon: 'none'
      });
      return;
    }

    this.setData({ processing: true });

    try {
      wx.showLoading({
        title: '添加中...',
        mask: true
      });

      let processedPath;

      if (this.data.watermarkType === 'text') {
        // 添加文字水印
        if (this.data.watermarkMode === 'tile') {
          // 平铺模式
          processedPath = await imageProcess.addTiledTextWatermark(
            this.data.imageSrc,
            this.data.watermarkText,
            {
              fontSize: this.data.fontSize,
              fontColor: this.data.fontColor,
              opacity: this.data.opacity,
              spacing: this.data.tileSpacing,
              rotation: this.data.tileRotation
            }
          );
        } else if (this.data.watermarkMode === 'diagonal') {
          // 对角线模式
          processedPath = await imageProcess.addTextWatermarkMulti(
            this.data.imageSrc,
            this.data.watermarkText,
            {
              fontSize: this.data.fontSize,
              fontColor: this.data.fontColor,
              opacity: this.data.opacity,
              positions: [1, 9] // 左上+右下
            }
          );
        } else if (this.data.watermarkMode === 'multi') {
          // 多位置模式
          processedPath = await imageProcess.addTextWatermarkMulti(
            this.data.imageSrc,
            this.data.watermarkText,
            {
              fontSize: this.data.fontSize,
              fontColor: this.data.fontColor,
              opacity: this.data.opacity,
              positions: this.data.selectedPositions
            }
          );
        } else {
          // 单位置模式（默认）
          processedPath = await imageProcess.addTextWatermark(
            this.data.imageSrc,
            this.data.watermarkText,
            {
              fontSize: this.data.fontSize,
              fontColor: this.data.fontColor,
              opacity: this.data.opacity,
              position: this.data.position
            }
          );
        }
      } else {
        // 添加图片水印
        if (this.data.watermarkMode === 'tile') {
          // 平铺模式
          processedPath = await imageProcess.addTiledImageWatermark(
            this.data.imageSrc,
            this.data.watermarkImage,
            {
              scale: this.data.imageScale / 100,
              opacity: this.data.opacity,
              spacing: this.data.tileSpacing,
              rotation: this.data.tileRotation
            }
          );
        } else if (this.data.watermarkMode === 'diagonal') {
          // 对角线模式
          processedPath = await imageProcess.addImageWatermarkMulti(
            this.data.imageSrc,
            this.data.watermarkImage,
            {
              scale: this.data.imageScale / 100,
              opacity: this.data.opacity,
              positions: [1, 9]
            }
          );
        } else if (this.data.watermarkMode === 'multi') {
          // 多位置模式
          processedPath = await imageProcess.addImageWatermarkMulti(
            this.data.imageSrc,
            this.data.watermarkImage,
            {
              scale: this.data.imageScale / 100,
              opacity: this.data.opacity,
              positions: this.data.selectedPositions
            }
          );
        } else {
          // 单位置模式（默认）
          processedPath = await imageProcess.addImageWatermark(
            this.data.imageSrc,
            this.data.watermarkImage,
            {
              scale: this.data.imageScale / 100,
              opacity: this.data.opacity,
              position: this.data.position
            }
          );
        }
      }

      this.setData({
        processedSrc: processedPath,
        showResult: true,
        processing: false
      });
      analytics.track('tool_complete', { toolId: 'watermark' });

      wx.hideLoading();
      wx.showToast({
        title: '添加成功',
        icon: 'success'
      });
    } catch (err) {
      console.error('添加水印失败', err);
      this.setData({ processing: false });
      wx.hideLoading();
      wx.showToast({
        title: '添加失败',
        icon: 'none'
      });
    }
  },

  /**
   * 保存图片
   */
  async saveImage() {
    if (!this.data.processedSrc) {
      wx.showToast({
        title: '请先添加水印',
        icon: 'none'
      });
      return;
    }

    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.processedSrc);
    } catch (err) {
      console.error('保存失败', err);
    }
  },

  /**
   * 对比查看（原图 vs 水印处理后）
   */
  onCompare() {
    if (!this.data.imageSrc || !this.data.processedSrc) {
      wx.showToast({ title: '请先添加水印', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.processedSrc, {
      title: '水印对比'
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
    analytics.trackShare('watermark', 'friend');
    return {
      title: '给图片加专属水印，防盗图防搬运',
      path: '/pages/watermark/watermark'
    };
  },

  onShareTimeline() {
    analytics.trackShare('watermark', 'timeline');
    return { title: '给图片加专属文字水印，防盗图' };
  }
});
