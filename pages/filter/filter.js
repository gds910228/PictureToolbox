// pages/filter/filter.js
const imageProcess = require('../../utils/image-process');
const compareHelper = require('../../utils/compare-helper');
const analytics = require('../../utils/analytics');

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
      { name: '美式', filter: 'contrast(1.2) sepia(0.2)', icon: '🇺🇸' },
      { name: '反色', filter: 'invert(1)', icon: '🔄' },
      { name: '胶片', filter: 'contrast(1.1) saturate(1.2) sepia(0.15)', icon: '🎞️' },
      { name: '黄昏', filter: 'sepia(0.4) saturate(1.4) hue-rotate(-15deg)', icon: '🌇' },
      { name: '青冷', filter: 'hue-rotate(200deg) saturate(1.2)', icon: '💎' },
      { name: '褪色', filter: 'saturate(0.55) contrast(0.95)', icon: '🍂' },
      { name: '明亮', filter: 'brightness(1.15) saturate(1.2) contrast(1.05)', icon: '💡' },
      { name: '怀旧', filter: 'sepia(0.5) contrast(0.9) saturate(0.85)', icon: '🕰️' },
      { name: '暗调', filter: 'contrast(1.4) brightness(0.85) saturate(1.1)', icon: '🌑' },
      { name: 'Lomo', filter: 'contrast(1.3) saturate(1.5) brightness(0.9)', icon: '📸' },
      { name: '银盐', filter: 'grayscale(0.3) contrast(1.2) sepia(0.2) brightness(1.05)', icon: '🪙' }
    ],
    selectedPresetIndex: 0,

    // 预设滤镜缩略预览：index -> tempFilePath；thumbLoading 生成中标志
    presetThumbs: {},
    thumbLoading: false,

    // AI风格（复用 aiStyleTransfer 云函数的 21 个官方风格，value 传给云函数）
    aiStyles: [
      { value: 'watercolor', label: '水彩画', icon: '💧' },
      { value: 'cartoon', label: '卡通插画', icon: '🎨' },
      { value: '3d-cartoon', label: '3D卡通', icon: '🎭' },
      { value: 'anime', label: '日系动漫', icon: '🎌' },
      { value: 'ancient', label: '唯美古风', icon: '🏮' },
      { value: '2.5d', label: '2.5D动画', icon: '🎬' },
      { value: 'wood-carving', label: '木雕', icon: '🪵' },
      { value: 'clay', label: '黏土', icon: '🟤' },
      { value: 'fresh-anime', label: '清新日漫', icon: '✨' },
      { value: 'comic', label: '小人书插画', icon: '📚' },
      { value: 'gongbi', label: '国风工笔', icon: '🖌️' },
      { value: 'jade', label: '玉石', icon: '💎' },
      { value: 'porcelain', label: '瓷器', icon: '🏺' },
      { value: 'felt-asia', label: '毛毡(亚洲版)', icon: '🧶' },
      { value: 'felt-west', label: '毛毡(欧美版)', icon: '🧵' },
      { value: 'vintage-us', label: '美式复古', icon: '🎞️' },
      { value: 'steampunk', label: '蒸汽朋克', icon: '⚙️' },
      { value: 'cyberpunk', label: '赛博朋克', icon: '🌃' },
      { value: 'sketch', label: '素描', icon: '✏️' },
      { value: 'monet', label: '莫奈花园', icon: '🌸' },
      { value: 'impasto', label: '厚涂手绘', icon: '🖼️' }
    ],
    selectedAIStyle: -1,
    aiFileID: '',        // 选定图上传到云存储的 fileID（AI风格用，复用避免重复上传）
    aiUsed: 0,
    aiLimit: 20,
    aiUsedText: '',

    // AI智能增强
    useAISmart: false,
    aiSmartType: 'auto',  // auto-自动, portrait-人像, landscape-风景, food-美食
    aiRecommendations: [],

    // 实时预览
    showRealTimePreview: false,
    previewFilter: ''
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'filter' });
    this.loadAIQuota();
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
          selectedAIStyle: -1,
          aiFileID: '',
          presetThumbs: {},
          thumbLoading: false
        });

        // 生成预设滤镜缩略预览（纯本地 canvas，无 API/无 token）
        this.generatePresetThumbs(filePath);

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
   * 批量生成预设滤镜缩略预览（纯本地 canvas，无 API/无 token）。
   * 策略：选图后用 4-6 并发对每个滤镜跑一遍 maxWidth=200 的缩略图，逐张回填 presetThumbs。
   * 所见即所得——预览与"应用滤镜"走同一 ctx.filter 路径，效果完全一致。
   */
  async generatePresetThumbs(filePath) {
    const presets = this.data.presets;
    const concurrency = Math.min(5, presets.length);
    this.setData({ thumbLoading: true, presetThumbs: {} });

    // 任务队列：每个滤镜一项
    const queue = presets.map((p, i) => ({ index: i, filter: p.filter }));
    const worker = async () => {
      while (queue.length) {
        const task = queue.shift();
        if (!task) return;
        try {
          const thumb = await imageProcess.applyPresetFilter(filePath, task.filter, { maxWidth: 200 });
          // 仅当仍是当前图时回填（防用户快速换图导致旧预览覆盖新图）
          if (this.data.imageSrc === filePath) {
            this.setData({ [`presetThumbs.${task.index}`]: thumb });
          }
        } catch (err) {
          console.error('[filter] 缩略预览生成失败', task.index, err);
          // 单个失败不影响其他，该项保持空（回退显示 emoji）
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (this.data.imageSrc === filePath) {
      this.setData({ thumbLoading: false });
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
   * 查询今日AI风格额度（只读，不消耗）。进页面调一次，让额度条提前可见。
   * demo 态（未配置密钥）不展示额度条。
   */
  async loadAIQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiStyleTransfer',
        data: { action: 'quota' }
      });
      const r = (res && res.result) || {};
      if (r.success && !r.demo) {
        this.setData({
          aiUsed: r.used || 0,
          aiLimit: r.limit || this.data.aiLimit,
          aiUsedText: buildAIUsedText(r.used, r.limit)
        });
      }
    } catch (e) {
      console.warn('[filter] 查询AI风格额度失败', e && (e.errMsg || e.message));
    }
  },

  /**
   * 上传图片到云存储拿 fileID（AI风格用）。含前端内容安全 guardImage。
   * @returns {Promise<string>} fileID；失败/拦截返回 ''
   */
  async uploadForAI(filePath) {
    const { guardImage } = require('../../utils/content-check');
    if (!(await guardImage(filePath))) {
      return '';  // 内容安全拦截，guardImage 已 toast
    }
    return new Promise((resolve) => {
      wx.cloud.uploadFile({
        cloudPath: `filterAI/${Date.now()}.jpg`,
        filePath: filePath,
        success: (res) => resolve(res.fileID),
        fail: () => {
          wx.showToast({ title: '上传失败', icon: 'none' });
          resolve('');
        }
      });
    });
  },

  /**
   * AI风格迁移（独立流程：确保 fileID → 调 aiStyleTransfer → 下载展示）
   * 复用创意玩法「风格迁移」的 aiStyleTransfer 云函数（混元图像风格化 ImageToImage）。
   */
  async applyAIStyle() {
    if (this.data.selectedAIStyle === -1) {
      wx.showToast({ title: '请选择AI风格', icon: 'none' });
      return;
    }

    this.setData({ processing: true });

    try {
      // 1. 确保图片已上传到云存储（复用 fileID，换风格不重传）
      let fileID = this.data.aiFileID;
      if (!fileID) {
        wx.showLoading({ title: '上传中...', mask: true });
        fileID = await this.uploadForAI(this.data.imageSrc);
        wx.hideLoading();
        if (!fileID) {
          this.setData({ processing: false });
          return;  // 上传失败或内容安全拦截，uploadForAI 已提示
        }
        this.setData({ aiFileID: fileID });
      }

      // 2. 调用风格迁移云函数
      wx.showLoading({ title: 'AI生成中...', mask: true });
      const styleValue = this.data.aiStyles[this.data.selectedAIStyle].value;
      const res = await wx.cloud.callFunction({
        name: 'aiStyleTransfer',
        data: { fileID: fileID, style: styleValue }
      });
      wx.hideLoading();

      const r = (res && res.result) || {};

      // 更新额度展示（成功/限流都会返回 used/limit）
      if (r.used != null && r.limit != null) {
        this.setData({
          aiUsed: r.used,
          aiLimit: r.limit,
          aiUsedText: buildAIUsedText(r.used, r.limit)
        });
      }

      if (r.success) {
        // 3. 下载结果图到本地展示
        wx.showLoading({ title: '加载结果中...', mask: true });
        try {
          const dl = await wx.cloud.downloadFile({ fileID: r.fileID });
          this.setData({
            processedSrc: dl.tempFilePath,
            showResult: true,
            processing: false
          });
          analytics.track('tool_complete', { toolId: 'filter', type: 'ai' });
          wx.hideLoading();
          wx.showToast({ title: '处理完成', icon: 'success' });
        } catch (e) {
          wx.hideLoading();
          this.setData({ processing: false });
          wx.showToast({ title: '结果加载失败', icon: 'none' });
        }
      } else if (r.error === 'rate_limit') {
        this.setData({ processing: false });
        wx.showModal({
          title: '额度已用完',
          content: `今日AI风格迁移 ${r.limit || this.data.aiLimit} 次额度已用完，次日 0 点重置`,
          showCancel: false
        });
      } else {
        this.setData({ processing: false });
        wx.showModal({
          title: 'AI生成失败',
          content: r.error || '未知错误，请稍后重试',
          showCancel: false
        });
      }
    } catch (err) {
      console.error('AI风格迁移失败', err);
      wx.hideLoading();
      this.setData({ processing: false });
      wx.showModal({
        title: '处理失败',
        content: err.message || err.errMsg || '未知错误',
        showCancel: false
      });
    }
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

    // AI风格走独立云函数流程（上传 → 调 aiStyleTransfer → 下载）
    if (this.data.filterType === 'ai') {
      this.applyAIStyle();
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
      }

      this.setData({
        processedSrc: processedPath,
        showResult: true,
        processing: false
      });
      analytics.track('tool_complete', { toolId: 'filter', type: this.data.filterType });

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
    analytics.trackShare('filter', 'friend');
    return {
      title: '图片滤镜：20+ 预设一键调色 + AI 风格化',
      path: '/pages/filter/filter'
    };
  },

  onShareTimeline() {
    analytics.trackShare('filter', 'timeline');
    return { title: '一键给图片加滤镜，20+ 风格可选' };
  }
});

/**
 * 构造今日AI风格额度文案。仅密钥可用时云函数才返回 used/limit；缺失/demo 则返回空串（不展示）。
 */
function buildAIUsedText(used, limit) {
  const u = Number(used);
  const l = Number(limit);
  if (!isFinite(u) || !isFinite(l) || l <= 0) return '';
  return `今日已用 ${u}/${l} 次`;
}
