// pages/formatRecommend/formatRecommend.js
// 图像格式推荐：选图 → 240 画布取像素 → 启发式特征提取 → 规则推荐 → JPG/PNG Canvas 真转换 + 实测算体积
// 全程前端本地，不依赖云函数与外部 API。引擎见 utils/format-recommend.js（已 53 例交叉验证）。
const imageProcess = require('../../utils/image-process');
const { extractFeatures, recommend, estimateSize } = require('../../utils/format-recommend');

const ANALYZE_MAX_EDGE = 240; // 分析画布最长边（控像素量，特征为尺度不变比率）
const EXPORT_MAX_EDGE = 2048; // 转换画布最长边（保高质、控内存）

const SCENARIOS = [
  { id: 'wechat', name: '微信传播' },
  { id: 'web', name: '网页/APP' },
  { id: 'storage', name: '归档存储' }
];
const TYPE_TEXT = { photo: '照片', screenshot: '截图', icon: '图标/插画' };
const FORMAT_UPPER = { jpg: 'JPG', png: 'PNG', webp: 'WEBP', avif: 'AVIF' };

Page({
  data: {
    sourcePath: '',
    sourceW: 0,
    sourceH: 0,
    sourceSizeText: '',
    sourceMetaText: '',
    analyzing: false,
    // 特征展示
    alphaText: '',
    colorCountText: '',
    typeText: '',
    edgeText: '',
    flatText: '',
    resolutionText: '',
    featureCount: 6,
    // 场景
    scenarios: SCENARIOS,
    currentScenario: 'wechat',
    // 推荐
    primary: null,
    alternatives: [],
    // 转换
    convertFormats: [
      { format: 'jpg', label: 'JPG' },
      { format: 'png', label: 'PNG' }
    ],
    convertFormat: 'jpg',
    convertQuality: 80,
    convertQualityText: '80',
    convertEstText: '',
    converting: false,
    convertPath: '',
    convertSizeText: '',
    showConvert: false
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '格式推荐' });
  },

  onUnload() {
    this._cancelled = true;
  },

  /* ---------------- 选图与分析 ---------------- */

  async chooseImage() {
    try {
      const paths = await imageProcess.chooseImage(1, ['original', 'compressed'], ['album', 'camera']);
      if (!paths || !paths.length) return;
      const filePath = paths[0];
      this._originalPath = filePath;
      this._features = null;
      this.setData({
        sourcePath: filePath,
        sourceW: 0,
        sourceH: 0,
        sourceSizeText: '',
        sourceMetaText: '',
        primary: null,
        alternatives: [],
        convertPath: '',
        convertSizeText: '',
        convertEstText: ''
      });
      await this._analyze(filePath);
    } catch (err) {
      if (err && err.errMsg && /cancel/i.test(err.errMsg)) return;
      console.error('选图失败', err);
      wx.showToast({ title: '选择失败', icon: 'none' });
    }
  },

  async _analyze(filePath) {
    this._cancelled = false;
    this.setData({ analyzing: true, primary: null, alternatives: [] });
    try {
      // 源图信息 + 体积
      const info = await imageProcess.getImageInfo(filePath);
      const megapixels = (info.width * info.height / 1000000).toFixed(1);
      let sizeText = '';
      try {
        const size = await imageProcess.getFileSize(filePath);
        sizeText = this._formatSize(size);
      } catch (e) { /* 忽略 */ }
      this.setData({
        sourceW: info.width,
        sourceH: info.height,
        sourceSizeText: sizeText,
        sourceMetaText: '原图：' + info.width + ' × ' + info.height + ' px' + (sizeText ? ' · ' + sizeText : ''),
        resolutionText: info.width + '×' + info.height + ' (' + megapixels + ' MP)'
      });

      // 分析画布尺寸（最长边 ≤ ANALYZE_MAX_EDGE）
      // 注意：直接绘制原图到 240 画布以保留透明通道（compressImage 会转 JPG 丢 alpha）
      const longest = Math.max(info.width, info.height);
      const scale = longest > ANALYZE_MAX_EDGE ? ANALYZE_MAX_EDGE / longest : 1;
      const W = Math.max(2, Math.round(info.width * scale));
      const H = Math.max(2, Math.round(info.height * scale));

      const canvas = await this._getCanvas();
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (typeof ctx.getImageData !== 'function') {
        throw new Error('当前微信版本不支持像素读取，请升级微信');
      }
      const img = await this._loadImage(canvas, info.path || filePath);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      img.src = '';
      await this._yield();

      const imgData = ctx.getImageData(0, 0, W, H);
      const rgba = imgData.data;
      const features = extractFeatures(rgba, W, H);
      this._features = features;

      if (this._cancelled) return;

      // 特征展示
      this.setData({
        alphaText: features.hasAlpha ? '有透明' : '不透明',
        colorCountText: features.richColor ? '≥32 色（丰富）' : ('约 ' + features.colorCount + ' 色'),
        typeText: TYPE_TEXT[features.type] || features.type,
        edgeText: Math.round(features.edgeDensity * 100) + '%',
        flatText: Math.round(features.flatRatio * 100) + '%'
      });

      this._buildRecommend();
    } catch (err) {
      console.error('格式推荐分析失败', err);
      wx.showModal({
        title: '分析失败',
        content: (err && err.message) ? err.message : '未知错误，请重试',
        showCancel: false
      });
    } finally {
      this.setData({ analyzing: false });
    }
  },

  /* ---------------- 推荐（场景切换/新图复用缓存特征） ---------------- */

  _buildRecommend() {
    const features = this._features;
    if (!features) return;
    const scenario = this.data.currentScenario;
    const sourcePixels = this.data.sourceW * this.data.sourceH || 1;
    const { primary, alternatives } = recommend(features, scenario, sourcePixels);

    const primaryView = this._toView(primary);
    const altViews = alternatives.map((a) => this._toView(a));

    // 默认转换格式：主推可转则用主推；否则第一个可转备选；否则 JPG
    let defaultFmt = 'jpg';
    if (primary.convertible) defaultFmt = primary.format;
    else {
      const conv = alternatives.find((a) => a.convertible);
      if (conv) defaultFmt = conv.format;
    }
    const showConvert = primary.convertible || alternatives.some((a) => a.convertible);

    this.setData({
      primary: primaryView,
      alternatives: altViews,
      convertFormat: defaultFmt,
      showConvert,
      convertPath: '',
      convertSizeText: ''
    });
    this._updateConvertEstimate();
  },

  _toView(rec) {
    const qualityText = rec.quality == null ? '无损' : ('Q' + rec.quality);
    return {
      format: rec.format,
      formatUpper: FORMAT_UPPER[rec.format] || rec.format.toUpperCase(),
      qualityText,
      sizeText: '约 ' + this._fmtRange(rec.size),
      reason: rec.reason,
      convertible: rec.convertible,
      convText: rec.convertible ? '可直接转换' : '需专业工具导出'
    };
  },

  selectScenario(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.currentScenario) return;
    this.setData({ currentScenario: id });
    if (this._features) this._buildRecommend();
  },

  /* ---------------- 转换参数 ---------------- */

  selectConvertFormat(e) {
    const fmt = e.currentTarget.dataset.format;
    if (fmt === this.data.convertFormat) return;
    this.setData({ convertFormat: fmt, convertPath: '', convertSizeText: '' });
    this._updateConvertEstimate();
  },

  onQualityChanging(e) {
    const q = e.detail.value;
    this.setData({ convertQualityText: String(q) });
    this._updateConvertEstimate(q);
  },

  onQualityChange(e) {
    const q = e.detail.value;
    this.setData({ convertQuality: q, convertQualityText: String(q) });
    this._updateConvertEstimate(q);
  },

  _updateConvertEstimate(q) {
    if (!this._features) return;
    const fmt = this.data.convertFormat;
    const quality = (q != null) ? q : this.data.convertQuality;
    const sourcePixels = this.data.sourceW * this.data.sourceH || 1;
    const size = estimateSize(this._features, fmt, quality, sourcePixels);
    this.setData({ convertEstText: '约 ' + this._fmtRange(size) });
  },

  /* ---------------- Canvas 真转换（实测算体积） ---------------- */

  async doConvert() {
    if (this.data.converting) return;
    const fmt = this.data.convertFormat;       // 'jpg' | 'png'
    const quality = this.data.convertQuality;  // 40-100（仅 jpg 生效）
    this.setData({ converting: true });
    try {
      const info = await imageProcess.getImageInfo(this._originalPath);
      const longest = Math.max(info.width, info.height);
      const scale = longest > EXPORT_MAX_EDGE ? EXPORT_MAX_EDGE / longest : 1;
      const W = Math.max(1, Math.round(info.width * scale));
      const H = Math.max(1, Math.round(info.height * scale));

      const canvas = await this._getCanvas();
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      const img = await this._loadImage(canvas, info.path || this._originalPath);
      // JPG 不支持透明：先铺白底，防透明图转 JPG 出现黑底
      if (fmt === 'jpg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.drawImage(img, 0, 0, W, H);
      img.src = '';
      await this._yield();

      const tempPath = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          fileType: fmt,
          quality: fmt === 'jpg' ? quality / 100 : 1,
          success: (r) => resolve(r.tempFilePath),
          fail: reject
        });
      });

      let sizeText = '';
      try {
        const size = await imageProcess.getFileSize(tempPath);
        sizeText = this._formatSize(size);
      } catch (e) { /* 忽略 */ }

      this.setData({ convertPath: tempPath, convertSizeText: sizeText });
      wx.showToast({ title: '转换完成', icon: 'success' });
    } catch (err) {
      console.error('格式转换失败', err);
      wx.showModal({
        title: '转换失败',
        content: (err && err.message) ? err.message : '未知错误，请重试',
        showCancel: false
      });
    } finally {
      this.setData({ converting: false });
    }
  },

  /* ---------------- 预览与保存 ---------------- */

  previewSource() {
    if (!this.data.sourcePath) return;
    wx.previewImage({ current: this.data.sourcePath, urls: [this.data.sourcePath] });
  },

  previewConvert() {
    if (!this.data.convertPath) return;
    wx.previewImage({ current: this.data.convertPath, urls: [this.data.convertPath] });
  },

  async saveConvert() {
    if (!this.data.convertPath) {
      wx.showToast({ title: '请先转换', icon: 'none' });
      return;
    }
    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.convertPath);
    } catch (err) {
      console.error('保存失败', err);
      wx.showModal({
        title: '保存失败',
        content: '可重试或检查相册权限',
        showCancel: false
      });
    }
  },

  clearImage() {
    this._features = null;
    this._originalPath = null;
    this.setData({
      sourcePath: '',
      sourceW: 0,
      sourceH: 0,
      sourceSizeText: '',
      sourceMetaText: '',
      primary: null,
      alternatives: [],
      convertPath: '',
      convertSizeText: '',
      convertEstText: ''
    });
  },

  /* ---------------- 工具 ---------------- */

  _getCanvas() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#analyzeCanvas')
        .fields({ node: true })
        .exec((res) => {
          if (res && res[0] && res[0].node) resolve(res[0].node);
          else reject(new Error('画布初始化失败'));
        });
    });
  },

  _loadImage(canvas, src) {
    return new Promise((resolve, reject) => {
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = src;
    });
  },

  _yield() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  },

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  },

  _fmtRange(size) {
    if (!size) return '';
    return this._fmtKB(size.minKB) + ' - ' + this._fmtKB(size.maxKB);
  },

  _fmtKB(kb) {
    if (kb < 1) return Math.round(kb * 1024) + ' B';
    if (kb < 1024) return Math.round(kb) + ' KB';
    return (kb / 1024).toFixed(1) + ' MB';
  },

  onShareAppMessage() {
    return { title: '格式推荐 - 图个简单', path: '/pages/formatRecommend/formatRecommend' };
  }
});
