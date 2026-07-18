// pages/colorAnalysis/colorAnalysis.js
// 图像颜色分析：选图 → 降采样 → Canvas 取像素 → Median Cut 提取主色 → 色卡展示/复制/导出
// 全程前端本地，不依赖云函数与外部 API。算法见 utils/color-quantize.js（已交叉验证）。
const imageProcess = require('../../utils/image-process');
const { buildPalette } = require('../../utils/color-quantize');
const analytics = require('../../utils/analytics');

const MIN_COUNT = 3;
const MAX_COUNT = 10;
const DEFAULT_COUNT = 6;

const ANALYZE_SRC_EDGE = 480; // 源图压缩上限（控制 canvas.createImage 的解码内存）
const ANALYZE_MAX_EDGE = 240; // 分析用画布最长边（控制送入量化的像素量，≤5.7w 像素）

// 导出色卡画布尺寸
const EXPORT_W = 1080;
const EXPORT_H = 560;

Page({
  data: {
    sourcePath: '',
    sourceW: 0,
    sourceH: 0,
    colorCount: DEFAULT_COUNT,
    colorCountText: DEFAULT_COUNT + ' 色',
    minCount: MIN_COUNT,
    maxCount: MAX_COUNT,
    palette: [],         // buildPalette 产物：[{r,g,b,hex,rgbText,hsl,hslText,pct,textColor}]
    analyzing: false,
    // 导出
    exportPath: '',
    exportSizeText: ''
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'colorAnalysis' });
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
      // 重置状态：新图
      this._rgba = null;
      this.setData({
        sourcePath: filePath,
        sourceW: 0,
        sourceH: 0,
        palette: [],
        exportPath: '',
        exportSizeText: ''
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
    this.setData({ analyzing: true, palette: [] });
    try {
      // 1. 压缩源图，控制解码内存（大图直接 createImage 可能 OOM）
      const compressed = await this._compressSrc(filePath);
      const info = await imageProcess.getImageInfo(compressed);
      this.setData({ sourceW: info.width, sourceH: info.height });

      // 2. 计算分析画布尺寸（最长边 ≤ ANALYZE_MAX_EDGE）
      const longest = Math.max(info.width, info.height);
      const scale = longest > ANALYZE_MAX_EDGE ? ANALYZE_MAX_EDGE / longest : 1;
      const W = Math.max(1, Math.round(info.width * scale));
      const H = Math.max(1, Math.round(info.height * scale));

      // 3. 画到 canvas 并取像素
      const canvas = await this._getCanvas();
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (typeof ctx.getImageData !== 'function') {
        throw new Error('当前微信版本不支持像素读取，请升级微信');
      }
      const img = await this._loadImage(canvas, info.path || compressed);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      img.src = '';
      await this._yield();

      const imgData = ctx.getImageData(0, 0, W, H);
      const rgba = imgData.data;
      this._rgba = rgba; // 缓存像素，供滑块改数量时即时重提取（无需重画 canvas）

      if (this._cancelled) return;
      const palette = buildPalette(rgba, this.data.colorCount);
      this.setData({ palette });
      analytics.track('tool_complete', { toolId: 'colorAnalysis' });
    } catch (err) {
      console.error('颜色分析失败', err);
      wx.showModal({
        title: '分析失败',
        content: (err && err.message) ? err.message : '未知错误，请重试',
        showCancel: false
      });
    } finally {
      this.setData({ analyzing: false });
    }
  },

  // 源图压缩：最长边限定 ANALYZE_SRC_EDGE
  async _compressSrc(filePath) {
    try {
      const info = await imageProcess.getImageInfo(filePath);
      const longest = Math.max(info.width, info.height);
      if (longest <= ANALYZE_SRC_EDGE) return filePath;
      const opt = info.width >= info.height
        ? { compressedWidth: ANALYZE_SRC_EDGE }
        : { compressedHeight: ANALYZE_SRC_EDGE };
      return await new Promise((resolve, reject) => {
        wx.compressImage(Object.assign({ src: filePath, quality: 85 }, opt, {
          success: (r) => resolve(r.tempFilePath),
          fail: reject
        }));
      });
    } catch (e) {
      return filePath; // 压缩失败回退原图
    }
  },

  /* ---------------- 颜色数量滑块 ---------------- */

  onCountChanging(e) {
    this.setData({ colorCountText: e.detail.value + ' 色' });
  },
  // 松手提交：复用缓存的像素数据，仅重新量化（<100ms，无需 loading）
  onCountChange(e) {
    const count = e.detail.value;
    this.setData({ colorCount: count, colorCountText: count + ' 色' });
    if (!this._rgba) return;
    try {
      const palette = buildPalette(this._rgba, count);
      this.setData({ palette, exportPath: '', exportSizeText: '' });
    } catch (err) {
      console.error('重新提取失败', err);
    }
  },

  /* ---------------- 复制 ---------------- */

  tapColor(e) {
    const hex = e.currentTarget.dataset.hex;
    if (!hex) return;
    wx.setClipboardData({
      data: hex,
      success: () => wx.showToast({ title: hex + ' 已复制', icon: 'none' })
    });
  },

  copyAllHex() {
    if (!this.data.palette.length) return;
    const text = this.data.palette.map((c) => c.hex).join('\n');
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制 ' + this.data.palette.length + ' 个色值', icon: 'none' })
    });
  },

  /* ---------------- 导出色卡图 ---------------- */

  async exportCard() {
    if (!this.data.palette.length) return;
    if (this.data.analyzing) return;
    this.setData({ analyzing: true });
    try {
      const canvas = await this._getCanvas();
      canvas.width = EXPORT_W;
      canvas.height = EXPORT_H;
      const ctx = canvas.getContext('2d');
      this._drawCard(ctx, this.data.palette);
      await this._yield();

      const tempPath = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          quality: 1,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        });
      });

      let sizeText = '';
      try {
        const size = await imageProcess.getFileSize(tempPath);
        sizeText = this._formatSize(size);
      } catch (e) { /* 忽略 */ }

      this.setData({ exportPath: tempPath, exportSizeText: sizeText });
      analytics.track('tool_complete', { toolId: 'colorAnalysis' });
      wx.showToast({ title: '色卡已生成', icon: 'success' });
    } catch (err) {
      console.error('导出色卡失败', err);
      wx.showModal({
        title: '导出失败',
        content: (err && err.message) ? err.message : '未知错误，请重试',
        showCancel: false
      });
    } finally {
      this.setData({ analyzing: false });
    }
  },

  // 将色卡绘制到 canvas（1080×560）：标题 + 色卡条 + HEX 信息区
  _drawCard(ctx, palette) {
    const W = EXPORT_W, H = EXPORT_H;
    // 背景：深空
    ctx.fillStyle = '#0A0E27';
    ctx.fillRect(0, 0, W, H);

    // 标题
    const TITLE_H = 90;
    ctx.fillStyle = '#00F0FF';
    ctx.font = 'bold 38px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COLOR PALETTE', W / 2, TITLE_H / 2);

    // 色卡条
    const STRIP_TOP = TITLE_H + 8;
    const STRIP_H = 340;
    const n = palette.length;
    const blockW = W / n;
    const hexFont = Math.max(20, Math.min(34, Math.floor(blockW / 4.3)));

    for (let i = 0; i < n; i++) {
      const x = i * blockW;
      ctx.fillStyle = palette[i].hex; // #RRGGBB，canvas 可识别
      ctx.fillRect(x, STRIP_TOP, blockW + 1, STRIP_H); // +1 防止相邻色块间出现接缝
      // 色块底部叠加占比（用对比色保证可读）
      ctx.fillStyle = palette[i].textColor;
      ctx.font = 'bold 26px sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(palette[i].pct + '%', x + blockW / 2, STRIP_TOP + STRIP_H - 18);
    }

    // 信息区：每列 HEX
    const INFO_TOP = STRIP_TOP + STRIP_H + 28;
    ctx.textBaseline = 'top';
    for (let i = 0; i < n; i++) {
      const cx = i * blockW + blockW / 2;
      ctx.fillStyle = '#E9ECEF';
      ctx.font = 'bold ' + hexFont + 'px sans-serif';
      ctx.fillText(palette[i].hex, cx, INFO_TOP);
    }
  },

  /* ---------------- 预览与保存 ---------------- */

  previewSource() {
    if (!this.data.sourcePath) return;
    wx.previewImage({ current: this.data.sourcePath, urls: [this.data.sourcePath] });
  },

  previewCard() {
    if (!this.data.exportPath) return;
    wx.previewImage({ current: this.data.exportPath, urls: [this.data.exportPath] });
  },

  async saveCard() {
    if (!this.data.exportPath) {
      wx.showToast({ title: '请先生成色卡', icon: 'none' });
      return;
    }
    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.exportPath);
    } catch (err) {
      console.error('保存色卡失败', err);
      wx.showModal({
        title: '保存失败',
        content: '可重试或检查相册权限',
        showCancel: false
      });
    }
  },

  clearImage() {
    this._rgba = null;
    this.setData({
      sourcePath: '',
      sourceW: 0,
      sourceH: 0,
      palette: [],
      exportPath: '',
      exportSizeText: ''
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

  onShareAppMessage() {
    analytics.trackShare('colorAnalysis', 'friend');
    return { title: '图片取色：提取主色调生成色卡，导出 HEX/RGB', path: '/pages/colorAnalysis/colorAnalysis' };
  },

  onShareTimeline() {
    analytics.trackShare('colorAnalysis', 'timeline');
    return { title: '提取图片主色调，生成配色色卡' };
  }
});
