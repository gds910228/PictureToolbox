// pages/crop/crop.js
// 图片裁剪（交互式）—— 选图 → EXIF 方向修正 → 限边 → 本地智能构图 → 交互裁剪框（拖拽/缩放/实时预览）→ Canvas 导出
//
// 设计：合并自原 aiSmartCrop，去掉云端 AI（冷启动慢、常猜错主体），保留即时本地主体定位 +
//   交互式裁剪框 + 平台尺寸预设。EXIF 方向修正解决「选左得右/镜像旋转」问题：
//   <image> 显示会自动转正 EXIF，但 Canvas drawImage 不转 → 先把图重新编码为正向工作图，
//   之后显示/定位/导出全部基于正向图，坐标一致。

const { ensureBounded } = require('../../utils/upscale-local');
const { detectSubject } = require('../../utils/saliency-detect');
const { getImageInfo } = require('../../utils/image-process');
const { RATIO_PRESETS, PLATFORM_PRESETS } = require('./presets');
const analytics = require('../../utils/analytics');

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 入口文件大小上限 20MB
const WORK_EDGE = 2048;                  // 工作图最长边（显示+导出，控内存，社交平台足够）
const MAX_EXPORT_EDGE = 2048;           // 导出最长边封顶
const PREVIEW_MAX_W = 260;             // 预览窗最大宽（px）
const PREVIEW_MAX_H = 320;             // 预览窗最大高（px）

Page({
  data: {
    imageSrc: '',        // 工作图（显示用，已正向）
    workPath: '',        // 工作图本地路径（导出用）
    imgW: 0, imgH: 0,    // 工作图自然尺寸
    stageW: 0, stageH: 0,  // 舞台显示尺寸（px）
    box: { x: 0, y: 0, w: 0, h: 0 }, // 裁剪框（显示坐标 px）
    ratioPresets: RATIO_PRESETS,
    platformPresets: PLATFORM_PRESETS,
    presetId: '1:1',
    ratio: 1,
    presetType: 'ratio',  // 'ratio' | 'platform'
    targetW: 0, targetH: 0,
    sliderVal: 100,
    detectSource: '',     // '' | 'local'
    processing: false,
    resultSrc: '', resultInfo: '', showResult: false,
    previewW: 0, previewH: 0,
    pvImgW: 0, pvImgH: 0, pvX: 0, pvY: 0
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'crop' });
    const sys = wx.getSystemInfoSync();
    this._screenW = sys.windowWidth;
    this._screenH = sys.windowHeight;
    this._maxStageH = sys.windowHeight * 0.58;
  },

  // ============================================================
  // 选图 + 预处理
  // ============================================================
  chooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original', 'compressed'],
      success(res) {
        const file = res.tempFiles[0];
        if (file.size && file.size > MAX_FILE_BYTES) {
          wx.showToast({ title: '图片过大（>20MB），请压缩后再试', icon: 'none', duration: 2500 });
          return;
        }
        that.setData({ imageSrc: file.tempFilePath, showResult: false, resultSrc: '', resultInfo: '', detectSource: '' });
        that.prepareImage(file.tempFilePath);
      }
    });
  },

  async prepareImage(filePath) {
    wx.showLoading({ title: '处理图片中...', mask: true });

    // 1) EXIF 方向修正（先转正，避免 Canvas 导出镜像/旋转）
    let uprightPath = filePath, uprightW = 0, uprightH = 0;
    try {
      const r = await reorientImage(filePath);
      uprightPath = r.path; uprightW = r.width; uprightH = r.height;
    } catch (e) {
      console.warn('[crop] EXIF 修正失败，用原图', e);
    }

    // 2) 最长边限制（基于正向图）
    let workPath = uprightPath, imgW = uprightW, imgH = uprightH;
    try {
      const b = await ensureBounded(uprightPath, WORK_EDGE);
      workPath = b.path; imgW = b.width; imgH = b.height;
    } catch (e) {
      console.warn('[crop] ensureBounded 失败，用正向图', e);
      if (!imgW || !imgH) {
        const info = await getImageInfo(uprightPath);
        workPath = uprightPath; imgW = info.width; imgH = info.height;
      }
    }

    // 3) 内容安全
    try {
      const { guardImage } = require('../../utils/content-check');
      if (!(await guardImage(workPath))) { wx.hideLoading(); this.setData({ imageSrc: '' }); return; }
    } catch (e) {
      console.warn('[crop] 内容安全检测异常，继续', e);
    }

    this.setData({ imageSrc: workPath, workPath, imgW, imgH });
    wx.hideLoading();

    // 4) 舞台布局 + 本地智能构图
    wx.nextTick(() => {
      this.layoutStage(() => this.runLocalDetect());
    });
  },

  // ============================================================
  // EXIF 方向修正：把任意 orientation 的图重新编码为正向（orientation=1）
  // ============================================================
  // 见模块底部 reorientImage 函数

  // ============================================================
  // 舞台布局
  // ============================================================
  layoutStage(cb) {
    const that = this;
    wx.createSelectorQuery().select('.stage-wrap').boundingClientRect((rect) => {
      const availW = (rect && rect.width) || (that._screenW - 32);
      const { imgW, imgH } = that.data;
      let stageW = availW;
      let stageH = stageW * imgH / imgW;
      if (stageH > that._maxStageH) {
        stageH = that._maxStageH;
        stageW = stageH * imgW / imgH;
      }
      that.setData({ stageW, stageH }, () => {
        that.computePreviewPane();
        that.fitBoxAt(that.data.ratio, 0.5, 0.5, that.data.sliderVal / 100);
        if (cb) cb();
      });
    }).exec();
  },

  // ============================================================
  // 本地智能构图（即时，免费）
  // ============================================================
  async runLocalDetect() {
    try {
      const r = await detectSubject(this.data.workPath);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      this.fitBoxAt(this.data.ratio, cx, cy, this.data.sliderVal / 100);
      this.setData({ detectSource: 'local' });
    } catch (e) {
      console.warn('[crop] 本地定位失败，用中心', e);
    }
  },

  // ============================================================
  // 裁剪框几何
  // ============================================================
  _maxBox(ratio) {
    const { stageW, stageH } = this.data;
    const r = ratio || (this.data.box.w / this.data.box.h) || 1;
    let w = stageW, h = w / r;
    if (h > stageH) { h = stageH; w = h * r; }
    return { w, h };
  },

  fitBoxAt(ratio, cxN, cyN, scale) {
    const { stageW, stageH } = this.data;
    const isFree = !ratio || ratio === 0;
    let w, h;
    if (isFree) {
      // 自由比例：保持当前框尺寸（无则取 80% 最大）
      const cur = this.data.box;
      w = (cur && cur.w) ? cur.w : stageW * 0.8;
      h = (cur && cur.h) ? cur.h : stageH * 0.8;
    } else {
      const max = this._maxBox(ratio);
      w = max.w * scale; h = max.h * scale;
    }
    const cx = cxN * stageW, cy = cyN * stageH;
    const x = this._clamp(cx - w / 2, 0, Math.max(0, stageW - w));
    const y = this._clamp(cy - h / 2, 0, Math.max(0, stageH - h));
    this.setData({ box: { x, y, w, h } });
    this.updatePreview({ x, y, w, h });
  },

  _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },

  _boxCenter() {
    const b = this.data.box;
    return { cxN: (b.x + b.w / 2) / this.data.stageW, cyN: (b.y + b.h / 2) / this.data.stageH };
  },

  // ============================================================
  // 预设切换
  // ============================================================
  selectRatio(e) {
    const id = e.currentTarget.dataset.id;
    const p = RATIO_PRESETS.find(r => r.id === id);
    if (!p) return;
    const c = this._boxCenter();
    this.setData({ presetId: id, ratio: p.ratio, presetType: 'ratio', targetW: 0, targetH: 0 });
    this.computePreviewPane();
    this.fitBoxAt(p.ratio, c.cxN, c.cyN, this.data.sliderVal / 100);
  },

  selectPlatform(e) {
    const id = e.currentTarget.dataset.id;
    const p = PLATFORM_PRESETS.find(r => r.id === id);
    if (!p) return;
    const c = this._boxCenter();
    this.setData({ presetId: id, ratio: p.ratio, presetType: 'platform', targetW: p.targetW, targetH: p.targetH });
    this.computePreviewPane();
    this.fitBoxAt(p.ratio, c.cxN, c.cyN, this.data.sliderVal / 100);
  },

  // ============================================================
  // 拖拽平移
  // ============================================================
  onBoxTouchStart(e) {
    const t = e.touches[0];
    this._drag = { startX: t.clientX, startY: t.clientY, box: Object.assign({}, this.data.box) };
  },
  onBoxTouchMove(e) {
    if (!this._drag) return;
    const t = e.touches[0];
    const dx = t.clientX - this._drag.startX;
    const dy = t.clientY - this._drag.startY;
    const b = this._drag.box;
    const { stageW, stageH } = this.data;
    const x = this._clamp(b.x + dx, 0, Math.max(0, stageW - b.w));
    const y = this._clamp(b.y + dy, 0, Math.max(0, stageH - b.h));
    const nb = { x, y, w: b.w, h: b.h };
    this.setData({ box: nb });
    this.updatePreview(nb);
  },
  onBoxTouchEnd() { this._drag = null; },

  // ============================================================
  // 缩放滑块
  // ============================================================
  onSlider(e) {
    const val = e.detail.value;
    this.setData({ sliderVal: val });
    const c = this._boxCenter();
    this.fitBoxAt(this.data.ratio, c.cxN, c.cyN, val / 100);
  },

  // ============================================================
  // 实时预览（CSS transform）
  // ============================================================
  computePreviewPane() {
    const ratio = this.data.ratio || 1;
    let pw = Math.min(this.data.stageW || this._screenW, PREVIEW_MAX_W);
    let ph = pw / ratio;
    if (ph > PREVIEW_MAX_H) { ph = PREVIEW_MAX_H; pw = ph * ratio; }
    this.setData({ previewW: pw, previewH: ph });
  },

  updatePreview(box) {
    const { stageW, stageH, previewW } = this.data;
    if (!stageW || !previewW) return;
    const s = previewW / box.w;
    this.setData({
      pvImgW: stageW * s,
      pvImgH: stageH * s,
      pvX: -box.x * s,
      pvY: -box.y * s
    });
  },

  // ============================================================
  // 导出裁剪结果
  // ============================================================
  onConfirm() {
    const that = this;
    const { box, stageW, imgW, imgH, presetType, targetW, targetH, presetId } = this.data;
    if (!stageW || !box.w) { wx.showToast({ title: '请先选择图片', icon: 'none' }); return; }

    this.setData({ processing: true });
    wx.showLoading({ title: '裁剪中...', mask: true });

    const natScale = imgW / stageW;
    const nx = box.x * natScale, ny = box.y * natScale;
    const nw = box.w * natScale, nh = box.h * natScale;

    let outW, outH;
    if (presetType === 'platform') {
      outW = targetW; outH = targetH;
    } else {
      outW = nw; outH = nh;
      const longest = Math.max(outW, outH);
      if (longest > MAX_EXPORT_EDGE) { const f = MAX_EXPORT_EDGE / longest; outW *= f; outH *= f; }
    }
    outW = Math.max(1, Math.round(outW));
    outH = Math.max(1, Math.round(outH));

    const canvas = wx.createOffscreenCanvas({ type: '2d', width: outW, height: outH });
    const ctx = canvas.getContext('2d');
    const image = canvas.createImage();
    image.onload = () => {
      ctx.drawImage(image, nx, ny, nw, nh, 0, 0, outW, outH);
      wx.canvasToTempFilePath({
        canvas, fileType: 'jpg', quality: 0.95,
        success: (r) => {
          wx.hideLoading();
          that.setData({ processing: false });
          const name = presetType === 'platform'
            ? (PLATFORM_PRESETS.find(p => p.id === presetId) || {}).name
            : (RATIO_PRESETS.find(p => p.id === presetId) || {}).name;
          that.setData({
            resultSrc: r.tempFilePath,
            resultInfo: `${name || ''} · ${outW} × ${outH} px`,
            showResult: true
          });
          analytics.track('tool_complete', { toolId: 'crop' });
        },
        fail: (err) => {
          wx.hideLoading();
          that.setData({ processing: false });
          console.error('[crop] 导出失败', err);
          wx.showToast({ title: '裁剪失败，请重试', icon: 'none' });
        }
      });
    };
    image.onerror = (err) => {
      wx.hideLoading();
      that.setData({ processing: false });
      console.error('[crop] 图片加载失败', err);
      wx.showToast({ title: '图片加载失败', icon: 'none' });
    };
    image.src = this.data.workPath;
  },

  // ============================================================
  // 结果操作
  // ============================================================
  saveResult() {
    const src = this.data.resultSrc;
    if (!src) { wx.showToast({ title: '请先裁剪', icon: 'none' }); return; }
    wx.saveImageToPhotosAlbum({
      filePath: src,
      success() { wx.showToast({ title: '已保存到相册', icon: 'success' }); },
      fail(err) {
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({ title: '提示', content: '需要您授权保存图片到相册', showCancel: false });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  },

  previewResult() {
    if (!this.data.resultSrc) return;
    wx.previewImage({ current: this.data.resultSrc, urls: [this.data.resultSrc] });
  },

  resetAll() {
    this.setData({
      imageSrc: '', workPath: '', imgW: 0, imgH: 0,
      stageW: 0, stageH: 0, box: { x: 0, y: 0, w: 0, h: 0 },
      presetId: '1:1', ratio: 1, presetType: 'ratio', targetW: 0, targetH: 0,
      sliderVal: 100, detectSource: '', processing: false,
      previewW: 0, previewH: 0, pvImgW: 0, pvImgH: 0, pvX: 0, pvY: 0,
      resultSrc: '', resultInfo: '', showResult: false
    });
  },

  onShareAppMessage() {
    analytics.trackShare('crop', 'friend');
    return { title: '图片裁剪 - 智能构图，多比例/平台尺寸', path: '/pages/crop/crop' };
  },

  onShareTimeline() {
    analytics.trackShare('crop', 'timeline');
    return { title: '图片裁剪：自定义任意比例，一键切图' };
  }
});

// ============================================================
// EXIF 方向修正：把任意 orientation 的图重新编码为正向（orientation=1）
// <image> 显示会自动转正 EXIF，但 Canvas drawImage 不转 → 先转正，统一坐标
// ============================================================
function reorientImage(filePath) {
  return new Promise((resolve, reject) => {
    getImageInfo(filePath).then((info) => {
      const { orientation, width, height, path } = info;
      if (!orientation || orientation <= 1) {
        resolve({ path: filePath, width, height });
        return;
      }
      // canvas = 正向（视觉）尺寸
      const canvas = wx.createOffscreenCanvas({ type: '2d', width, height });
      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();
      image.onload = () => {
        // EXIF orientation → canvas transform（标准映射，blueimp 参考）
        switch (orientation) {
          case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
          case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
          case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
          case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
          case 6: ctx.transform(0, 1, -1, 0, height, 0); break;
          case 7: ctx.transform(0, -1, -1, 0, height, width); break;
          case 8: ctx.transform(0, -1, 1, 0, 0, width); break;
        }
        ctx.drawImage(image, 0, 0, image.width, image.height);
        wx.canvasToTempFilePath({
          canvas, fileType: 'jpg', quality: 0.95,
          success: (res) => resolve({ path: res.tempFilePath, width, height }),
          fail: (err) => { console.warn('[crop] EXIF 转正导出失败，用原图', err); resolve({ path: filePath, width, height }); }
        });
      };
      image.onerror = (err) => { console.warn('[crop] EXIF 转正加载失败，用原图', err); resolve({ path: filePath, width, height }); };
      image.src = path;
    }).catch(reject);
  });
}
