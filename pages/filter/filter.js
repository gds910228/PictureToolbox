// pages/filter/filter.js
const imageProcess = require('../../utils/image-process');
const compareHelper = require('../../utils/compare-helper');

Page({
  data: {
    imageSrc: '',
    processedSrc: '',
    showResult: false,
    processing: false,

    // 滤镜类型：adjust-手动调节, preset-预设滤镜, ai-AI风格
    filterType: 'preset',

    // 手动调节参数
    brightness: 100,  // 亮度
    contrast: 100,    // 对比度
    saturate: 100,    // 饱和度
    blur: 0,          // 模糊
    hueRotate: 0,     // 色相旋转

    // 预设滤镜
    presets: [
      { name: '原图', filter: 'none', icon: '🖼️' },
      { name: '复古', filter: 'sepia(0.8)', icon: '📷' },
      { name: '黑白', filter: 'grayscale(1)', icon: '⚫' },
      { name: '高对比', filter: 'contrast(1.5)', icon: '🔲' },
      { name: '鲜艳', filter: 'saturate(1.8)', icon: '🌈' },
      { name: '冷色', filter: 'hue-rotate(180deg)', icon: '❄️' },
      { name: '暖色', filter: 'sepia(0.3) saturate(1.5)', icon: '☀️' },
      { name: '模糊', filter: 'blur(3px)', icon: '🌫️' },
      { name: '日系', filter: 'brightness(1.1) contrast(0.9) saturate(0.8)', icon: '🌸' },
      { name: '美式', filter: 'contrast(1.2) sepia(0.2)', icon: '🇺🇸' }
    ],
    selectedPresetIndex: 0,

    // AI风格
    aiStyles: [
      { name: '梵高星空', desc: '印象派油画风格', prompt: '梵高星空风格', filter: 'saturate(1.5) contrast(1.2) hue-rotate(20deg)' },
      { name: '赛博朋克', desc: '未来科技感', prompt: '赛博朋克风格', filter: 'saturate(2) contrast(1.5) hue-rotate(180deg) brightness(1.1)' },
      { name: '中国水墨', desc: '传统水墨画', prompt: '中国水墨画风格', filter: 'grayscale(0.8) contrast(1.3) brightness(1.1)' },
      { name: '卡通动漫', desc: '二次元风格', prompt: '日式动漫风格', filter: 'saturate(1.3) contrast(1.2) brightness(1.05)' },
      { name: '油画', desc: '经典油画', prompt: '经典油画风格', filter: 'contrast(1.3) sepia(0.3) saturate(1.2)' },
      { name: '素描', desc: '铅笔素描效果', prompt: '铅笔素描风格', filter: 'grayscale(1) contrast(1.5) brightness(1.1)' },
      { name: '水彩', desc: '水彩画风', prompt: '水彩画风格', filter: 'saturate(0.9) brightness(1.1) contrast(0.9)' },
      { name: '波普艺术', desc: '波普艺术风格', prompt: '波普艺术风格', filter: 'saturate(2.5) contrast(1.8) brightness(1.1)' },
      { name: '复古照片', desc: '老照片质感', prompt: '复古照片风格', filter: 'sepia(0.6) contrast(0.9) brightness(0.9)' },
      { name: '霓虹灯', desc: '霓虹灯光效', prompt: '霓虹灯风格', filter: 'saturate(2.2) contrast(1.6) brightness(1.2)' },
      { name: '浮雕', desc: '立体浮雕效果', prompt: '浮雕风格', filter: 'grayscale(1) contrast(2) brightness(1.2)' },
      { name: '像素艺术', desc: '8-bit像素风', prompt: '像素艺术风格', filter: 'saturate(1.2) contrast(1.5)' },
      { name: '印象派', desc: '莫奈印象派', prompt: '印象派风格', filter: 'saturate(1.4) brightness(1.1) contrast(1.1) hue-rotate(10deg)' },
      { name: '超现实主义', desc: '达利风格', prompt: '超现实主义风格', filter: 'hue-rotate(45deg) saturate(1.6) contrast(1.3)' },
      { name: '油画棒', desc: '油画棒质感', prompt: '油画棒风格', filter: 'saturate(1.3) contrast(1.1) sepia(0.2)' },
      { name: '版画', desc: '木刻版画效果', prompt: '版画风格', filter: 'grayscale(1) contrast(2.5) brightness(1.1)' },
      { name: '抽象艺术', desc: '抽象表现主义', prompt: '抽象艺术风格', filter: 'hue-rotate(90deg) saturate(1.8) contrast(1.4)' },
      { name: '粉彩', desc: '粉彩画风格', prompt: '粉彩画风格', filter: 'saturate(0.7) brightness(1.15) contrast(0.85)' }
    ],
    selectedAIStyle: -1,

    // AI智能增强
    useAISmart: false,
    aiSmartType: 'auto',  // auto-自动, portrait-人像, landscape-风景, food-美食
    aiRecommendations: [],

    // 实时预览
    showRealTimePreview: false,
    previewFilter: ''
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '图片滤镜'
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

        this.setData({
          imageSrc: filePath,
          processedSrc: '',
          showResult: false,
          brightness: 100,
          contrast: 100,
          saturate: 100,
          blur: 0,
          hueRotate: 0,
          selectedPresetIndex: 0,
          selectedAIStyle: -1
        });

        // 自动分析图片并推荐滤镜
        this.analyzeImageAndRecommend();
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
   * 切换滤镜类型
   */
  switchFilterType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      filterType: type,
      processedSrc: '',
      showResult: false
    });
  },

  /**
   * 亮度调节
   */
  onBrightnessChange(e) {
    this.setData({
      brightness: parseInt(e.detail.value),
      showRealTimePreview: false
    });
  },

  /**
   * 对比度调节
   */
  onContrastChange(e) {
    this.setData({
      contrast: parseInt(e.detail.value),
      showRealTimePreview: false
    });
  },

  /**
   * 饱和度调节
   */
  onSaturateChange(e) {
    this.setData({
      saturate: parseInt(e.detail.value),
      showRealTimePreview: false
    });
  },

  /**
   * 模糊调节
   */
  onBlurChange(e) {
    this.setData({
      blur: parseInt(e.detail.value),
      showRealTimePreview: false
    });
  },

  /**
   * 色相旋转调节
   */
  onHueRotateChange(e) {
    this.setData({
      hueRotate: parseInt(e.detail.value),
      showRealTimePreview: false
    });
  },

  /**
   * 选择预设滤镜
   */
  selectPreset(e) {
    const index = parseInt(e.currentTarget.dataset.index);
    this.setData({
      selectedPresetIndex: index,
      processedSrc: '',
      showResult: false
    });
  },

  /**
   * 选择AI风格
   */
  selectAIStyle(e) {
    const index = parseInt(e.currentTarget.dataset.index);
    this.setData({
      selectedAIStyle: index,
      processedSrc: '',
      showResult: false
    });
  },

  /**
   * 切换AI智能增强
   */
  toggleAISmart(e) {
    const useAISmart = e.detail.value;
    this.setData({
      useAISmart: useAISmart
    });

    if (useAISmart && this.data.imageSrc) {
      this.getAIRecommendations();
    }
  },

  /**
   * AI智能增强类型
   */
  onAISmartTypeChange(e) {
    this.setData({
      aiSmartType: e.detail.value
    });

    if (this.data.useAISmart) {
      this.getAIRecommendations();
    }
  },

  /**
   * 分析图片并推荐滤镜
   */
  async analyzeImageAndRecommend() {
    try {
      // TODO: 调用AI分析图片内容
      // 这里先用模拟数据
      await new Promise(resolve => setTimeout(resolve, 800));

      const mockRecommendations = [
        { type: 'preset', name: '日系', reason: '图片色调柔和，适合日系滤镜' },
        { type: 'preset', name: '鲜艳', reason: '提升色彩饱和度，让画面更生动' }
      ];

      this.setData({
        aiRecommendations: mockRecommendations
      });
    } catch (err) {
      console.error('AI分析失败', err);
    }
  },

  /**
   * 获取AI推荐
   */
  async getAIRecommendations() {
    if (!this.data.imageSrc) {
      wx.showToast({
        title: '请先选择图片',
        icon: 'none'
      });
      return;
    }

    try {
      wx.showLoading({ title: 'AI分析中...' });

      // TODO: 调用云函数获取AI推荐
      await new Promise(resolve => setTimeout(resolve, 1500));

      let recommendations = [];

      if (this.data.aiSmartType === 'portrait') {
        recommendations = [
          { type: 'preset', name: '日系', reason: '柔和色调适合人像' },
          { type: 'adjust', name: '美颜', reason: '智能美白+柔光', params: { brightness: 110, contrast: 95 } }
        ];
      } else if (this.data.aiSmartType === 'landscape') {
        recommendations = [
          { type: 'preset', name: '鲜艳', reason: '增强风景色彩' },
          { type: 'preset', name: '高对比', reason: '强化画面层次感' }
        ];
      } else if (this.data.aiSmartType === 'food') {
        recommendations = [
          { type: 'preset', name: '暖色', reason: '增加食欲感' },
          { type: 'adjust', name: '美食', reason: '提升饱和度+暖色调', params: { saturate: 130, brightness: 105 } }
        ];
      } else {
        // auto
        recommendations = [
          { type: 'preset', name: '日系', reason: '适合大多数场景' },
          { type: 'preset', name: '鲜艳', reason: '让画面更生动' }
        ];
      }

      this.setData({
        aiRecommendations: recommendations
      });

      wx.hideLoading();
    } catch (err) {
      console.error('获取推荐失败', err);
      wx.hideLoading();
      wx.showToast({
        title: '获取推荐失败',
        icon: 'none'
      });
    }
  },

  /**
   * 应用AI推荐
   */
  applyRecommendation(e) {
    const { recommendation } = e.currentTarget.dataset;

    if (recommendation.type === 'preset') {
      const index = this.data.presets.findIndex(p => p.name === recommendation.name);
      if (index !== -1) {
        this.setData({
          selectedPresetIndex: index,
          filterType: 'preset'
        });
      }
    } else if (recommendation.type === 'adjust') {
      this.setData({
        filterType: 'adjust',
        brightness: recommendation.params.brightness || 100,
        contrast: recommendation.params.contrast || 100,
        saturate: recommendation.params.saturate || 100
      });
    }
  },

  /**
   * 开始应用滤镜
   */
  async startApplyFilter() {
    if (!this.data.imageSrc) {
      wx.showToast({
        title: '请先选择图片',
        icon: 'none'
      });
      return;
    }

    this.setData({ processing: true });

    try {
      wx.showLoading({
        title: '处理中...',
        mask: true
      });

      let processedPath;

      if (this.data.filterType === 'adjust') {
        // 手动调节
        processedPath = await imageProcess.applyAdjustments(
          this.data.imageSrc,
          {
            brightness: this.data.brightness,
            contrast: this.data.contrast,
            saturate: this.data.saturate,
            blur: this.data.blur,
            hueRotate: this.data.hueRotate
          }
        );
      } else if (this.data.filterType === 'preset') {
        // 预设滤镜
        const selectedPreset = this.data.presets[this.data.selectedPresetIndex];
        processedPath = await imageProcess.applyPresetFilter(
          this.data.imageSrc,
          selectedPreset.filter
        );
      } else if (this.data.filterType === 'ai') {
        // AI风格迁移
        if (this.data.selectedAIStyle === -1) {
          wx.showToast({
            title: '请选择AI风格',
            icon: 'none'
          });
          this.setData({ processing: false });
          wx.hideLoading();
          return;
        }

        const selectedStyle = this.data.aiStyles[this.data.selectedAIStyle];

        wx.showLoading({
          title: 'AI生成中...',
          mask: true
        });

        // 使用滤镜模拟AI风格效果
        processedPath = await imageProcess.applyPresetFilter(
          this.data.imageSrc,
          selectedStyle.filter
        );

        // 模拟AI处理时间，增加真实感
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      this.setData({
        processedSrc: processedPath,
        showResult: true,
        processing: false
      });

      wx.hideLoading();
      wx.showToast({
        title: '处理完成',
        icon: 'success'
      });
    } catch (err) {
      console.error('应用滤镜失败', err);
      this.setData({ processing: false });
      wx.hideLoading();
      wx.showToast({
        title: '处理失败',
        icon: 'none'
      });
    }
  },

  /**
   * 重置参数
   */
  resetParams() {
    this.setData({
      brightness: 100,
      contrast: 100,
      saturate: 100,
      blur: 0,
      hueRotate: 0,
      selectedPresetIndex: 0,
      processedSrc: '',
      showResult: false
    });
  },

  /**
   * 保存图片
   */
  async saveImage() {
    if (!this.data.processedSrc) {
      wx.showToast({
        title: '请先应用滤镜',
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
   * 对比查看（原图 vs 滤镜处理后）
   */
  onCompare() {
    if (!this.data.imageSrc || !this.data.processedSrc) {
      wx.showToast({ title: '请先应用滤镜', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.processedSrc, {
      title: '滤镜对比'
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
      title: '图片滤镜 - 图片工具箱',
      path: '/pages/filter/filter'
    };
  }
});
