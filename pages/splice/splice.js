// pages/splice/splice.js
const imageProcess = require('../../utils/image-process');

Page({
  data: {
    images: [],              // 选中的图片列表
    maxImages: 9,            // 最多图片数量
    processedSrc: '',
    showResult: false,
    processing: false,

    // 拼接模式
    spliceMode: 'grid',      // horizontal-横向, vertical-纵向, grid-网格
    gridRows: 3,             // 网格行数
    gridCols: 3,             // 网格列数

    // 拼接参数
    spacing: 10,             // 间距
    cornerRadius: 0,         // 圆角
    backgroundColor: '#ffffff',  // 背景色
    backgroundImage: '',     // 背景图

    // AI智能布局
    useAI: false,
    aiAnalyzing: false,
    aiLayoutSuggestion: null,

    // 图片操作
    currentImageIndex: -1,
    showImageActions: false
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '图片拼接'
    });
  },

  /**
   * 选择图片
   */
  async chooseImage() {
    const remainCount = this.data.maxImages - this.data.images.length;

    if (remainCount <= 0) {
      wx.showToast({
        title: '最多选择9张图片',
        icon: 'none'
      });
      return;
    }

    try {
      const files = await imageProcess.chooseImage(remainCount, ['original'], ['album', 'camera']);

      if (files && files.length > 0) {
        const newImages = files.map(filePath => ({
          path: filePath,
          id: Date.now() + Math.random()
        }));

        this.setData({
          images: [...this.data.images, ...newImages],
          processedSrc: '',
          showResult: false
        });

        // 如果开启AI且图片数量>=2，自动分析
        if (this.data.useAI && this.data.images.length >= 2) {
          this.analyzeWithAI();
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
   * 删除图片
   */
  deleteImage(e) {
    const { index } = e.currentTarget.dataset;
    const images = this.data.images.filter((_, i) => i !== index);

    this.setData({
      images: images,
      processedSrc: '',
      showResult: false
    });
  },

  /**
   * 交换图片位置
   */
  swapImage(fromIndex, toIndex) {
    const images = [...this.data.images];
    const temp = images[fromIndex];
    images[fromIndex] = images[toIndex];
    images[toIndex] = temp;

    this.setData({
      images: images
    });
  },

  /**
   * 切换拼接模式
   */
  switchSpliceMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      spliceMode: mode,
      processedSrc: '',
      showResult: false
    });
  },

  /**
   * 行数改变
   */
  onRowsChange(e) {
    this.setData({
      gridRows: parseInt(e.detail.value)
    });
  },

  /**
   * 列数改变
   */
  onColsChange(e) {
    this.setData({
      gridCols: parseInt(e.detail.value)
    });
  },

  /**
   * 间距改变
   */
  onSpacingChange(e) {
    this.setData({
      spacing: parseInt(e.detail.value)
    });
  },

  /**
   * 圆角改变
   */
  onCornerRadiusChange(e) {
    this.setData({
      cornerRadius: parseInt(e.detail.value)
    });
  },

  /**
   * 背景颜色选择
   */
  onBackgroundColorChange(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({
      backgroundColor: color
    });
  },

  /**
   * 选择背景图片
   */
  async chooseBackgroundImage() {
    try {
      const files = await imageProcess.chooseImage(1, ['original'], ['album']);

      if (files && files.length > 0) {
        this.setData({
          backgroundImage: files[0]
        });
      }
    } catch (err) {
      console.error('选择背景图失败', err);
    }
  },

  /**
   * 清除背景图
   */
  clearBackgroundImage() {
    this.setData({
      backgroundImage: ''
    });
  },

  /**
   * 切换AI智能布局
   */
  toggleAI(e) {
    const useAI = e.detail.value;

    this.setData({
      useAI: useAI,
      aiLayoutSuggestion: null
    });

    if (useAI && this.data.images.length >= 2) {
      this.analyzeWithAI();
    }
  },

  /**
   * AI分析图片并推荐布局
   */
  async analyzeWithAI() {
    if (this.data.images.length < 2) {
      wx.showToast({
        title: '请至少选择2张图片',
        icon: 'none'
      });
      return;
    }

    this.setData({ aiAnalyzing: true });

    try {
      wx.showLoading({
        title: 'AI分析中...',
        mask: true
      });

      // TODO: 调用云函数分析图片
      // 先用模拟数据
      await new Promise(resolve => setTimeout(resolve, 2000));

      const count = this.data.images.length;
      let suggestion = {
        mode: 'grid',
        rows: 3,
        cols: 3,
        reason: 'AI分析了图片内容，建议使用九宫格布局，可以很好地展示所有图片'
      };

      if (count === 2) {
        suggestion = {
          mode: 'horizontal',
          reason: '2张图片适合横向拼接，形成长图效果'
        };
      } else if (count === 3) {
        suggestion = {
          mode: 'vertical',
          reason: '3张图片适合纵向拼接，形成连续的长图'
        };
      } else if (count === 4) {
        suggestion = {
          mode: 'grid',
          rows: 2,
          cols: 2,
          reason: '4张图片使用2x2网格布局最为均衡'
        };
      } else if (count <= 6) {
        suggestion = {
          mode: 'grid',
          rows: 2,
          cols: 3,
          reason: '建议使用2x3网格，布局紧凑美观'
        };
      }

      this.setData({
        aiLayoutSuggestion: suggestion,
        aiAnalyzing: false
      });

      wx.hideLoading();
      wx.showToast({
        title: 'AI分析完成',
        icon: 'success'
      });
    } catch (err) {
      console.error('AI分析失败', err);
      this.setData({ aiAnalyzing: false });
      wx.hideLoading();
      wx.showToast({
        title: 'AI分析失败',
        icon: 'none'
      });
    }
  },

  /**
   * 应用AI建议
   */
  applyAISuggestion() {
    if (!this.data.aiLayoutSuggestion) return;

    const { mode, rows, cols } = this.data.aiLayoutSuggestion;

    this.setData({
      spliceMode: mode,
      gridRows: rows || 3,
      gridCols: cols || 3
    });
  },

  /**
   * 开始拼接
   */
  async startSplice() {
    if (this.data.images.length < 2) {
      wx.showToast({
        title: '请至少选择2张图片',
        icon: 'none'
      });
      return;
    }

    this.setData({ processing: true });

    try {
      wx.showLoading({
        title: '拼接中...',
        mask: true
      });

      const params = {
        mode: this.data.spliceMode,
        spacing: this.data.spacing,
        cornerRadius: this.data.cornerRadius,
        backgroundColor: this.data.backgroundColor,
        backgroundImage: this.data.backgroundImage,
        gridRows: this.data.gridRows,
        gridCols: this.data.gridCols
      };

      const processedPath = await imageProcess.spliceImages(
        this.data.images.map(img => img.path),
        params
      );

      this.setData({
        processedSrc: processedPath,
        showResult: true,
        processing: false
      });

      wx.hideLoading();
      wx.showToast({
        title: '拼接完成',
        icon: 'success'
      });
    } catch (err) {
      console.error('拼接失败', err);
      this.setData({ processing: false });
      wx.hideLoading();
      wx.showToast({
        title: '拼接失败',
        icon: 'none'
      });
    }
  },

  /**
   * 清空所有图片
   */
  clearAll() {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有图片吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            images: [],
            processedSrc: '',
            showResult: false,
            aiLayoutSuggestion: null
          });
        }
      }
    });
  },

  /**
   * 保存图片
   */
  async saveImage() {
    if (!this.data.processedSrc) {
      wx.showToast({
        title: '请先拼接图片',
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
   * 预览原图
   */
  previewOriginalImages(e) {
    const { index } = e.currentTarget.dataset;
    const urls = this.data.images.map(img => img.path);
    wx.previewImage({
      current: urls[index],
      urls: urls
    });
  },

  /**
   * 分享
   */
  onShareAppMessage() {
    return {
      title: '图片拼接 - 图片工具箱',
      path: '/pages/splice/splice'
    };
  }
});
