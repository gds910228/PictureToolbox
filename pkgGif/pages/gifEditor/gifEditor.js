// pkgGif/pages/gifEditor/gifEditor.js
// GIF 编辑器：选择已有 GIF → 解码帧 → 裁剪/文字/擦除/删除/截取/倒放/调速 → 实时预览 → 差量编码导出
// 全程前端本地实现，不依赖外部 API。
// 解码见 utils/gif-decoder.js，编码见 utils/gif-encoder.js，像素操作见 utils/gif-frame-ops.js。
const imageProcess = require('../../../utils/image-process');
const { decodeGifChunked } = require('../../utils/gif-decoder');
const { buildGIFDiff, buildGIFDiffAdaptive } = require('../../utils/gif-encoder');
const { compressGif } = require('../../utils/gif-compress');
const effects = require('../../utils/gif-effects');
const frameOps = require('../../utils/gif-frame-ops');
const report = require('../../utils/gif-report');
const analytics = require('../../../utils/analytics');

const DRAFT_KEY = 'gifEditor_draft';
const DRAFT_SOURCE = 'gifEditor_source.gif';

// 内存防护阈值
const MAX_DIMENSION = 480;
const MAX_FRAMES = 60;        // 提升到 60（懒加载缩略图降低内存峰值）
const MAX_TOTAL_PIXELS = MAX_DIMENSION * MAX_DIMENSION * MAX_FRAMES;
const THUMB_SIZE = 120;
const LAZY_THUMB_BATCH = 8;   // 懒加载每批生成缩略图数
const UNDO_LIMIT = 10;        // 每帧擦除撤销步数上限

// 调速档位
const SPEED_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x' }
];

// 裁剪比例
const CROP_RATIOS = [
  { value: 0, label: '自由', w: 0, h: 0 },
  { value: 1, label: '1:1', w: 1, h: 1 },
  { value: 4 / 3, label: '4:3', w: 4, h: 3 },
  { value: 16 / 9, label: '16:9', w: 16, h: 9 },
  { value: 9 / 16, label: '9:16', w: 9, h: 16 }
];

// 文字颜色（基于设计 token）
const TEXT_COLORS = [
  { value: '#FFFFFF', label: '白' },
  { value: '#00F0FF', label: '青' },
  { value: '#FF0080', label: '粉' },
  { value: '#FF6B35', label: '橙' },
  { value: '#B026FF', label: '紫' },
  { value: '#000000', label: '黑' },
  { value: '#ADB5BD', label: '灰' }
];

const GRID_POSITIONS = [
  { value: 'tl', label: '↖' }, { value: 'tc', label: '↑' }, { value: 'tr', label: '↗' },
  { value: 'ml', label: '←' }, { value: 'mc', label: '●' }, { value: 'mr', label: '→' },
  { value: 'bl', label: '↙' }, { value: 'bc', label: '↓' }, { value: 'br', label: '↘' }
];

const ERASER_SIZES = [4, 12, 24];

let _textIdCounter = 0;

Page({
  data: {
    // 源文件信息
    fileName: '',
    fileSizeText: '',
    gifWidth: 0,
    gifHeight: 0,
    loopCount: 0,
    // 帧列表
    frames: [],
    selectedCount: 0,
    selectMode: false,
    currentFrame: 0,
    // 编辑模式：edit / crop / text / erase
    mode: 'edit',
    // 调速
    speed: 1,
    speedIndex: 1,
    rangeStart: 0,
    rangeEnd: 0,
    rangeStartText: '1',
    rangeEndText: '1',
    // 预览
    previewPlaying: false,
    // 导出
    exporting: false,
    progress: 0,
    progressText: '',
    resultPath: '',
    resultSize: 0,
    resultSizeText: '',
    // 解码进度
    decoding: false,
    decodeProgress: 0,
    decodeText: '',
    // 选项
    speedOptions: SPEED_OPTIONS,
    cropRatios: CROP_RATIOS,
    cropRatioIndex: 0,
    textColors: TEXT_COLORS,
    gridPositions: GRID_POSITIONS,
    eraserSizes: ERASER_SIZES,
    eraserSizeIndex: 1,
    frameLabels: [],
    maxFrames: MAX_FRAMES,
    maxDimension: MAX_DIMENSION,
    undoLimit: UNDO_LIMIT,
    // 裁剪状态
    cropActive: false,
    cropBox: null,       // {x, y, w, h} 相对画布像素
    cropRatio: 0,
    canUndoCrop: false,
    // 文字状态
    texts: [],           // [{id, text, fontSize, color, colorIndex, opacity, stroke, x, y, gridPos, frameScope, rangeStart, rangeEnd}]
    editingTextId: null,
    textInput: '',
    textFontSize: 24,
    textColorIndex: 0,
    textOpacity: 1,
    textStroke: true,
    textGridPos: 'bc',
    textFrameScope: 'all', // 'all' | 'range'
    textRangeStart: 0,
    textRangeEnd: 0,
    textRangeStartText: '1',
    textRangeEndText: '1',
    // 擦除状态
    eraserActive: false,
    eraserSize: 12,
    eraseScope: 'current', // 'current' 仅当前帧 | 'all' 全部帧
    canUndoErase: false,
    canRedoErase: false,
    // 预览画布显示尺寸和缩放
    canvasScale: 1,
    canvasDisplayW: 0,
    canvasDisplayH: 0,
    // 帧列表懒加载
    thumbLoadedCount: 0,
    lazyLoading: false,
    // 拆帧导出
    exportingFrames: false,
    exportFrameProgress: 0,
    exportFrameText: '',
    // 信息面板
    showInfoPanel: false,
    infoData: null,
    // 自适应调色板
    useAdaptive: false,
    // 压缩
    compressEnabled: false,
    targetSize: 1.0,
    sizeUnit: 'MB',      // 'KB' | 'MB' 目标体积单位
    // 草稿
    hasDraft: false
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'gifEditor' });
    this._checkDraft();
  },

  onUnload() {
    this._stopPreview();
    this._cancelled = true;
    this._saveDraft();
  },

  // 页面隐藏（跳转报告/草稿页、切后台）即停预览：
  // 定时器 + setData + canvas 绘制在隐藏页继续跑会持续耗电并触发性能告警
  onHide() {
    this._stopPreview();
  },

  onReady() {
    this._queryCanvasSize();
  },

  // 计算画布显示尺寸和缩放比例（适配屏幕宽度）
  _queryCanvasSize() {
    const sysInfo = wx.getSystemInfoSync();
    const screenW = sysInfo.windowWidth;
    const pagePadding = 32; // var(--space-lg) = 32px
    const availableW = screenW - pagePadding * 2 - 32; // card padding
    const maxH = 380; // 预览最大高度 px

    const W = this.data.gifWidth || 1;
    const H = this.data.gifHeight || 1;
    let scale = Math.min(1, availableW / W, maxH / H);
    const displayW = Math.round(W * scale);
    const displayH = Math.round(H * scale);

    this._canvasScale = scale;
    this.setData({
      canvasScale: scale,
      canvasDisplayW: displayW,
      canvasDisplayH: displayH
    });
  },

  // 同步帧列表到 data
  _syncFrames(extra) {
    const frames = this._frames.map((f, i) => ({
      index: i,
      delayMs: f.delayMs,
      thumbPath: f.thumbPath || '',
      selected: false,
      thumbLoaded: !!f.thumbPath
    }));
    const frameLabels = frames.map(f => String(f.index + 1));
    const count = frames.length;
    this.setData(Object.assign({
      frames,
      frameLabels,
      selectedCount: 0,
      selectMode: false,
      rangeStart: 0,
      rangeEnd: count - 1,
      rangeStartText: '1',
      rangeEndText: String(count),
      textRangeStart: 0,
      textRangeEnd: count - 1,
      textRangeStartText: '1',
      textRangeEndText: String(count),
      resultPath: '',
      resultSize: 0
    }, extra || {}));
  },

  /* ---------------- 选择与解码 ---------------- */

  chooseGif() {
    this._lastSource = 'chat';
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['gif'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        this._loadGifFile(file.path, file.size, file.name);
      },
      fail: (err) => {
        if (err && err.errMsg && /cancel/i.test(err.errMsg)) return;
        wx.showToast({ title: '选择文件失败', icon: 'none' });
      }
    });
  },

  // 相册辅助入口：微信通常会把相册 GIF 转码为静态 JPG（取第一帧），
  // 仅当环境直出 .gif 原文件时可用；GIF8 头部校验兜底，坏文件进不了解码流程。
  chooseFromAlbum() {
    this._lastSource = 'album';
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this._loadGifFile(f.tempFilePath, f.size, '相册图片.gif');
      },
      fail: (err) => {
        if (err && err.errMsg && /cancel/i.test(err.errMsg)) return;
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      }
    });
  },

  // 导入指引：chooseMessageFile type:'file' 只认"文件消息"（蓝色文件卡片），
  // 以图片/表情发送的 GIF 不可见——这是线上"无记录"的根因，文案必须讲清"以文件发送"这个动作。
  showImportGuide() {
    wx.showModal({
      title: '如何导入 GIF',
      content: '1. 把 .gif 文件发到聊天（推荐「文件传输助手」）：点 + → 文件 → 选择 .gif，发送后显示为文件卡片\n2. 回到本页点上方卡片「从聊天导入」，选中该聊天即可\n\n注意：\n· 以图片/表情方式发送的 GIF 不是文件，选不到\n· iOS 相册里的 GIF 需先「存储到文件」再发送',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  async _loadGifFile(filePath, fileSize, fileName, opts) {
    this._abortEraseStroke();
    this._sourceSize = fileSize || 0;
    // 草稿恢复时 fileSize 为 0，读完后用实际字节数兜底（避免显示 "0 B"）
    this.setData({
      decoding: true,
      decodeProgress: 0,
      decodeText: '读取文件...'
    });
    try {
      const fs = wx.getFileSystemManager();
      const buffer = await new Promise((resolve, reject) => {
        fs.readFile({ filePath, success: r => resolve(r.data), fail: reject });
      });

      if (!fileSize && buffer && buffer.byteLength) {
        this._sourceSize = buffer.byteLength;
        fileSize = buffer.byteLength;
      }

      const head = new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength));
      const sig = String.fromCharCode(head[0], head[1], head[2], head[3], head[4], head[5]);
      if (sig !== 'GIF87a' && sig !== 'GIF89a') {
        this.setData({ decoding: false });
        wx.showModal({
          title: '不是 GIF 文件',
          content: this._lastSource === 'album'
            ? '微信把相册里的 GIF 转成了静态图（只取第一帧），拿不到动画帧。请把 .gif 以「文件」发到聊天（+ → 文件），再用「从聊天导入」。'
            : '该文件不是有效的 GIF 格式（可能发送时被转码为 JPG）。请从聊天文件中选择原始 .gif 文件。',
          showCancel: false
        });
        return;
      }

      // 头部预检尺寸：超限 GIF 直接拒绝，不再白付整段解码成本
      const headBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024));
      let quickW = 0, quickH = 0;
      try {
        quickW = headBytes[6] | (headBytes[7] << 8);
        quickH = headBytes[8] | (headBytes[9] << 8);
      } catch (e) { /* ignore */ }

      if (quickW > 0 && quickH > 0 && Math.max(quickW, quickH) > MAX_DIMENSION) {
        this.setData({ decoding: false });
        wx.showModal({
          title: 'GIF 尺寸过大',
          content: `该 GIF 尺寸为 ${quickW}×${quickH}，超过 ${MAX_DIMENSION}px 上限。`,
          showCancel: false
        });
        return;
      }

      // 一律走分块解码：同步 decodeGif 会长时间占满 JS 线程，触发性能告警
      this.setData({ decodeText: '分块解码中...', decodeProgress: 5 });
      const decoded = await decodeGifChunked(buffer, {
        batchSize: 4,
        onProgress: (d, t) => {
          this.setData({ decodeProgress: 5 + Math.round(d / t * 80), decodeText: `解码帧 ${d}/${t}` });
        }
      });

      const longest = Math.max(decoded.width, decoded.height);
      if (longest > MAX_DIMENSION) {
        this.setData({ decoding: false });
        wx.showModal({
          title: 'GIF 尺寸过大',
          content: `该 GIF 尺寸为 ${decoded.width}×${decoded.height}，超过 ${MAX_DIMENSION}px 上限。`,
          showCancel: false
        });
        return;
      }

      // 强制帧数上限（UI 文案承诺 maxFrames，此前只查总像素未查帧数）
      if (decoded.frameCount > MAX_FRAMES) {
        this.setData({ decoding: false });
        wx.showModal({
          title: 'GIF 帧数过多',
          content: `该 GIF 共 ${decoded.frameCount} 帧，超过 ${MAX_FRAMES} 帧上限。`,
          showCancel: false
        });
        return;
      }

      const totalPixels = decoded.width * decoded.height * decoded.frameCount;
      if (totalPixels > MAX_TOTAL_PIXELS) {
        this.setData({ decoding: false });
        wx.showModal({
          title: 'GIF 帧数过多',
          content: `该 GIF 共 ${decoded.frameCount} 帧，总像素量超出限制。`,
          showCancel: false
        });
        return;
      }

      // 初始化帧数据（缩略图懒加载）
      this._frames = decoded.frames.map(f => ({
        rgba: f.rgba,
        delayMs: f.delayMs,
        thumbPath: '',
        undoStack: [],
        redoStack: []
      }));
      this._preCropSnapshot = null;
      this._eraseStrokes = [];
      this._cropState = null;
      this._gifHeader = sig;
      this._discardDraft();
      // 保存源文件副本用于草稿恢复（草稿恢复路径跳过——文件本来就在）
      if (!(opts && opts.skipSourceSave)) {
        await this._saveSourceToStorage(buffer);
      }

      this.setData({
        fileName: fileName || 'unknown.gif',
        fileSizeText: this._formatSize(fileSize || 0),
        gifWidth: decoded.width,
        gifHeight: decoded.height,
        loopCount: decoded.loopCount,
        speed: 1,
        speedIndex: 1,
        mode: 'edit',
        cropActive: false,
        texts: [],
        currentFrame: 0,
        thumbLoadedCount: 0,
        previewPlaying: false
      });
      this._syncFrames();

      // 懒加载：先生成第一批缩略图
      this.setData({ decodeText: '生成缩略图...', decodeProgress: 50 });
      await this._yield();
      await this._lazyGenerateThumbs(0);

      this.setData({
        decoding: false,
        decodeProgress: 100,
        decodeText: '完成'
      });

      // 渲染首帧
      setTimeout(() => {
        this._queryCanvasSize();
        this._renderStaticFrame(0);
      }, 50);

      analytics.track('gif_decode', {
        toolId: 'gifEditor',
        frames: decoded.frameCount,
        width: decoded.width,
        height: decoded.height
      });
    } catch (err) {
      this.setData({ decoding: false });
      console.error('GIF 解码失败', err);
      wx.showModal({
        title: '解码失败',
        content: (err && err.message) ? err.message : '无法解析该 GIF 文件。',
        showCancel: false
      });
    }
  },

  // 懒加载缩略图：从 startIdx 开始生成一批
  async _lazyGenerateThumbs(startIdx) {
    if (!this._frames) return;
    const endIdx = Math.min(startIdx + LAZY_THUMB_BATCH, this._frames.length);
    this.setData({ lazyLoading: true });
    for (let i = startIdx; i < endIdx; i++) {
      if (this._frames[i].thumbPath) continue;
      const thumbPath = await this._makeThumbnail(
        this._frames[i].rgba, this.data.gifWidth, this.data.gifHeight
      );
      this._frames[i].thumbPath = thumbPath;
    }
    // 更新 data 中的缩略图
    const frames = this.data.frames.slice();
    for (let i = startIdx; i < endIdx; i++) {
      if (frames[i]) {
        frames[i] = { ...frames[i], thumbPath: this._frames[i].thumbPath, thumbLoaded: true };
      }
    }
    this.setData({
      frames,
      thumbLoadedCount: endIdx,
      lazyLoading: false
    });
  },

  // 帧列表滚动时触发懒加载
  onThumbScroll() {
    if (this.data.lazyLoading || !this._frames) return;
    const loaded = this.data.thumbLoadedCount;
    if (loaded < this._frames.length) {
      // 当已加载接近末尾时加载下一批
      this._lazyGenerateThumbs(loaded);
    }
  },

  _makeThumbnail(rgba, srcW, srcH) {
    // 用离屏画布而非隐藏 WXML canvas：隐藏 canvas 在真机上不保证及时光栅化，
    // 同 tick 立即 canvasToTempFilePath 会拍到未初始化显存（彩色噪点）。
    // 复用 utils/upscale-local.js 已验证的 wx.createOffscreenCanvas 模式。
    return new Promise((resolve) => {
      try {
        const scale = Math.min(THUMB_SIZE / srcW, THUMB_SIZE / srcH, 1);
        const tw = Math.max(1, Math.round(srcW * scale));
        const th = Math.max(1, Math.round(srcH * scale));
        if (!this._thumbCanvas) {
          this._thumbCanvas = wx.createOffscreenCanvas({ type: '2d', width: tw, height: th });
        }
        const canvas = this._thumbCanvas;
        canvas.width = tw; canvas.height = th;
        const ctx = canvas.getContext('2d');
        const small = new Uint8ClampedArray(tw * th * 4);
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const sx = Math.min(srcW - 1, Math.floor(x * srcW / tw));
            const sy = Math.min(srcH - 1, Math.floor(y * srcH / th));
            const si = (sy * srcW + sx) * 4;
            const di = (y * tw + x) * 4;
            small[di] = rgba[si]; small[di+1] = rgba[si+1];
            small[di+2] = rgba[si+2]; small[di+3] = rgba[si+3];
          }
        }
        const imgData = ctx.createImageData(tw, th);
        imgData.data.set(small);
        ctx.putImageData(imgData, 0, 0);
        wx.canvasToTempFilePath({
          canvas, x: 0, y: 0, width: tw, height: th,
          destWidth: tw, destHeight: th, fileType: 'png',
          success: r => resolve(r.tempFilePath),
          fail: () => resolve('')
        });
      } catch (e) { console.error('缩略图失败', e); resolve(''); }
    });
  },

  /* ---------------- 模式切换 ---------------- */

  setMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this._stopPreview();
    if (mode !== 'erase') this._abortEraseStroke();
    const extra = { mode };
    if (mode === 'crop') {
      extra.cropActive = true;
      this._initCropBox();
    } else {
      extra.cropActive = false;
    }
    if (mode === 'erase') {
      extra.eraserActive = true;
      this._updateEraseButtons();
    } else {
      extra.eraserActive = false;
    }
    this.setData(extra);
    // 重新查询画布尺寸（布局可能变化）
    setTimeout(() => this._queryCanvasSize(), 50);
  },

  /* ---------------- 帧选择与删除（原有功能） ---------------- */

  toggleSelectMode() {
    const selectMode = !this.data.selectMode;
    const frames = this.data.frames.map(f => ({ ...f, selected: false }));
    this.setData({ selectMode, frames, selectedCount: 0, resultPath: '', resultSize: 0 });
    this._stopPreview();
  },

  toggleFrameSelect(e) {
    // dataset 取出的 index 是字符串，必须 Number() 强转
    // （字符串 currentFrame 会污染擦除 hint / 帧高亮 / undo 联动的严格比较）
    const index = Number(e.currentTarget.dataset.index);
    if (!this.data.selectMode) {
      // 非多选模式：切换当前帧
      this.setData({ currentFrame: index });
      this._renderStaticFrame(index);
      return;
    }
    const frames = this.data.frames.slice();
    frames[index] = { ...frames[index], selected: !frames[index].selected };
    this.setData({ frames, selectedCount: frames.filter(f => f.selected).length, resultPath: '', resultSize: 0 });
  },

  selectAllFrames() {
    const frames = this.data.frames.map(f => ({ ...f, selected: true }));
    this.setData({ frames, selectedCount: frames.length });
  },

  deleteSelected() {
    if (!this.data.selectedCount) return;
    const count = this.data.selectedCount;
    wx.showModal({
      title: '删除帧',
      content: `确定删除选中的 ${count} 帧？`,
      success: (r) => {
        if (!r.confirm) return;
        const keep = [];
        for (let i = 0; i < this._frames.length; i++) {
          if (!this.data.frames[i].selected) keep.push(this._frames[i]);
        }
        if (keep.length === 0) { wx.showToast({ title: '至少保留 1 帧', icon: 'none' }); return; }
        this._frames = keep;
        this._syncFrames({ currentFrame: 0 });
        this._stopPreview();
        this._renderStaticFrame(0);
      }
    });
  },

  onRangeStartChange(e) {
    const v = Number(e.detail.value);
    if (v > this.data.rangeEnd) { wx.showToast({ title: '起始帧不能大于结束帧', icon: 'none' }); return; }
    this.setData({ rangeStart: v, rangeStartText: String(v + 1) });
  },
  onRangeEndChange(e) {
    const v = Number(e.detail.value);
    if (v < this.data.rangeStart) { wx.showToast({ title: '结束帧不能小于起始帧', icon: 'none' }); return; }
    this.setData({ rangeEnd: v, rangeEndText: String(v + 1) });
  },

  trimRange() {
    const { rangeStart, rangeEnd } = this.data;
    if (rangeStart >= rangeEnd) { wx.showToast({ title: '区间无效', icon: 'none' }); return; }
    const count = rangeEnd - rangeStart + 1;
    wx.showModal({
      title: '截取帧',
      content: `保留第 ${rangeStart + 1} ~ ${rangeEnd + 1} 帧（共 ${count} 帧）？`,
      success: (r) => {
        if (!r.confirm) return;
        this._frames = this._frames.slice(rangeStart, rangeEnd + 1);
        this._syncFrames({ currentFrame: 0 });
        this._stopPreview();
        this._renderStaticFrame(0);
      }
    });
  },

  reverseFrames() {
    if (this._frames.length < 2) return;
    wx.showModal({
      title: '倒放',
      content: '将所有帧的顺序反转？',
      success: (r) => {
        if (!r.confirm) return;
        this._frames.reverse();
        this._syncFrames({ currentFrame: 0 });
        this._stopPreview();
        this._renderStaticFrame(0);
      }
    });
  },

  setSpeed(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({ speedIndex: idx, speed: SPEED_OPTIONS[idx].value });
  },

  /* ---------------- 画布裁剪 ---------------- */

  _initCropBox() {
    const W = this.data.gifWidth, H = this.data.gifHeight;
    // 默认裁剪框：居中 80% 区域
    const cw = Math.round(W * 0.8);
    const ch = Math.round(H * 0.8);
    this.setData({
      cropBox: {
        x: Math.round((W - cw) / 2),
        y: Math.round((H - ch) / 2),
        w: cw,
        h: ch
      },
      cropRatio: 0,
      cropRatioIndex: 0
    });
  },

  setCropRatio(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const ratio = CROP_RATIOS[idx];
    const W = this.data.gifWidth, H = this.data.gifHeight;
    let box = { ...this.data.cropBox };

    if (ratio.w > 0) {
      // 按比例调整裁剪框（以当前中心为基准）
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      let cw = box.w, ch = box.h;
      const targetRatio = ratio.w / ratio.h;
      if (cw / ch > targetRatio) cw = Math.round(ch * targetRatio);
      else ch = Math.round(cw / targetRatio);
      // 最小 16px
      cw = Math.max(16, cw); ch = Math.max(16, ch);
      box.x = Math.round(cx - cw / 2);
      box.y = Math.round(cy - ch / 2);
      box.w = cw; box.h = ch;
      // clamp
      box = this._clampCropBox(box, W, H);
    }

    this.setData({ cropRatioIndex: idx, cropRatio: ratio.value, cropBox: box });
  },

  _clampCropBox(box, W, H) {
    box.x = Math.max(0, Math.min(box.x, W - 16));
    box.y = Math.max(0, Math.min(box.y, H - 16));
    box.w = Math.max(16, Math.min(box.w, W - box.x));
    box.h = Math.max(16, Math.min(box.h, H - box.y));
    return box;
  },

  // 裁剪框拖拽
  onCropTouchStart(e) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    this._cropDrag = {
      startX: t.x, startY: t.y,
      box: { ...this.data.cropBox }
    };
    // 判断拖拽类型（通过 dataset.handle）
    this._cropHandle = e.currentTarget.dataset.handle || 'move';
  },

  onCropTouchMove(e) {
    if (!this._cropDrag) return;
    const t = e.touches[0];
    const scale = 1 / (this._canvasScale || 1); // CSS px → canvas px
    const dx = Math.round((t.x - this._cropDrag.startX) * scale);
    const dy = Math.round((t.y - this._cropDrag.startY) * scale);
    const W = this.data.gifWidth, H = this.data.gifHeight;
    let box = { ...this._cropDrag.box };
    const handle = this._cropHandle;

    if (handle === 'move') {
      box.x = this._cropDrag.box.x + dx;
      box.y = this._cropDrag.box.y + dy;
    } else {
      // 边缘/角拖拽
      if (handle.indexOf('l') >= 0) { box.x = this._cropDrag.box.x + dx; box.w = this._cropDrag.box.w - dx; }
      if (handle.indexOf('r') >= 0) { box.w = this._cropDrag.box.w + dx; }
      if (handle.indexOf('t') >= 0) { box.y = this._cropDrag.box.y + dy; box.h = this._cropDrag.box.h - dy; }
      if (handle.indexOf('b') >= 0) { box.h = this._cropDrag.box.h + dy; }

      // 固定比例时调整对边
      if (this.data.cropRatio > 0) {
        const targetRatio = this.data.cropRatio;
        if (handle === 'l' || handle === 'r') {
          box.h = Math.round(box.w / targetRatio);
        } else {
          box.w = Math.round(box.h * targetRatio);
        }
      }
    }

    box = this._clampCropBox(box, W, H);
    this.setData({ cropBox: box });
  },

  onCropTouchEnd() {
    this._cropDrag = null;
    this._cropHandle = null;
  },

  confirmCrop() {
    const box = this.data.cropBox;
    if (!box || box.w < 16 || box.h < 16) {
      wx.showToast({ title: '裁剪区域太小', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认裁剪',
      content: `裁剪为 ${box.w}×${box.h}？所有帧将应用此裁剪。`,
      success: (r) => {
        if (!r.confirm) return;
        this._applyCrop(box);
      }
    });
  },

  _applyCrop(box) {
    wx.showLoading({ title: '裁剪中...', mask: true });
    try {
      // 保存裁剪前快照（用于撤销）
      if (!this._preCropSnapshot) {
        this._preCropSnapshot = {
          width: this.data.gifWidth,
          height: this.data.gifHeight,
          frames: this._frames.map(f => ({
            rgba: frameOps.cloneFrame(f.rgba),
            delayMs: f.delayMs
          }))
        };
      }

      const oldW = this.data.gifWidth, oldH = this.data.gifHeight;
      for (let i = 0; i < this._frames.length; i++) {
        const f = this._frames[i];
        f.rgba = frameOps.cropFrame(f.rgba, oldW, oldH, box.x, box.y, box.w, box.h);
        f.thumbPath = ''; // 清空缩略图，重新生成
        f.undoStack = [];
        f.redoStack = [];
      }

      this.setData({
        gifWidth: box.w,
        gifHeight: box.h,
        cropActive: false,
        mode: 'edit',
        canUndoCrop: true,
        currentFrame: 0
      });
      this._cropState = { x: box.x, y: box.y, w: box.w, h: box.h };
      // 裁剪后擦除笔画坐标失效，清空
      this._eraseStrokes = [];
      this._syncFrames();
      this._scheduleDraftSave();

      // 重新生成缩略图
      this._lazyGenerateThumbs(0);
      setTimeout(() => {
        this._queryCanvasSize();
        this._renderStaticFrame(0);
      }, 50);
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      console.error('裁剪失败', e);
      wx.showToast({ title: '裁剪失败', icon: 'none' });
    }
  },

  undoCrop() {
    if (!this._preCropSnapshot) return;
    wx.showModal({
      title: '撤销裁剪',
      content: '恢复到裁剪前的状态？',
      success: (r) => {
        if (!r.confirm) return;
        const snap = this._preCropSnapshot;
        this._frames = snap.frames.map(f => ({
          rgba: frameOps.cloneFrame(f.rgba),
          delayMs: f.delayMs,
          thumbPath: '',
          undoStack: [],
          redoStack: []
        }));
        this._preCropSnapshot = null;
        this._cropState = null; // 裁剪已回退，防幽灵 crop 进后续草稿
        this.setData({
          gifWidth: snap.width,
          gifHeight: snap.height,
          canUndoCrop: false,
          currentFrame: 0
        });
        this._syncFrames();
        this._lazyGenerateThumbs(0);
        this._renderStaticFrame(0);
      }
    });
  },

  cancelCrop() {
    this.setData({ cropActive: false, mode: 'edit' });
    this._renderStaticFrame(this.data.currentFrame);
  },

  /* ---------------- 文字覆盖 ---------------- */

  onTextInput(e) {
    this.setData({ textInput: e.detail.value });
  },

  setTextFontSize(e) {
    this.setData({ textFontSize: Number(e.currentTarget.dataset.size) });
  },

  setTextColor(e) {
    this.setData({ textColorIndex: Number(e.currentTarget.dataset.index) });
  },

  setTextOpacity(e) {
    this.setData({ textOpacity: Number(e.currentTarget.dataset.opacity) });
  },

  onOpacityChanging(e) {
    this.setData({ textOpacity: e.detail.value / 100 });
  },

  onOpacityChange(e) {
    this.setData({ textOpacity: e.detail.value / 100 });
  },

  onCanvasTap() {
    // 文字模式下点击画布空白处：取消文字选中
    this.setData({ editingTextId: null });
  },

  toggleTextStroke() {
    this.setData({ textStroke: !this.data.textStroke });
  },

  setTextGridPos(e) {
    this.setData({ textGridPos: e.currentTarget.dataset.pos });
  },

  setTextScope(e) {
    this.setData({ textFrameScope: e.currentTarget.dataset.scope });
  },

  onTextRangeStart(e) {
    const v = Number(e.detail.value);
    if (v > this.data.textRangeEnd) return;
    this.setData({ textRangeStart: v, textRangeStartText: String(v + 1) });
  },
  onTextRangeEnd(e) {
    const v = Number(e.detail.value);
    if (v < this.data.textRangeStart) return;
    this.setData({ textRangeEnd: v, textRangeEndText: String(v + 1) });
  },

  addText() {
    const text = this.data.textInput.trim();
    if (!text) { wx.showToast({ title: '请输入文字', icon: 'none' }); return; }

    const W = this.data.gifWidth, H = this.data.gifHeight;
    const fontSize = this.data.textFontSize;
    const measured = frameOps.measureText(text, fontSize);
    const pos = frameOps.nineGridPosition(W, H, measured.w, measured.h, this.data.textGridPos);

    const newText = {
      id: ++_textIdCounter,
      text: text,
      fontSize: fontSize,
      color: TEXT_COLORS[this.data.textColorIndex].value,
      colorIndex: this.data.textColorIndex,
      opacity: this.data.textOpacity,
      stroke: this.data.textStroke,
      x: pos.x,
      y: pos.y,
      gridPos: this.data.textGridPos,
      frameScope: this.data.textFrameScope,
      rangeStart: this.data.textFrameScope === 'range' ? this.data.textRangeStart : 0,
      rangeEnd: this.data.textFrameScope === 'range' ? this.data.textRangeEnd : this._frames.length - 1
    };

    const texts = this.data.texts.concat(newText);
    this.setData({
      texts,
      textInput: '',
      editingTextId: newText.id
    });
    this._renderStaticFrame(this.data.currentFrame);
  },

  selectText(e) {
    const id = e.currentTarget.dataset.id;
    const t = this.data.texts.find(x => x.id === id);
    if (!t) return;
    this.setData({
      editingTextId: id,
      textInput: t.text,
      textFontSize: t.fontSize,
      textColorIndex: t.colorIndex,
      textOpacity: t.opacity,
      textStroke: t.stroke,
      textGridPos: t.gridPos,
      textFrameScope: t.frameScope,
      textRangeStart: t.rangeStart,
      textRangeEnd: t.rangeEnd,
      textRangeStartText: String(t.rangeStart + 1),
      textRangeEndText: String(t.rangeEnd + 1)
    });
  },

  updateText() {
    const id = this.data.editingTextId;
    if (!id) return;
    const text = this.data.textInput.trim();
    if (!text) { wx.showToast({ title: '请输入文字', icon: 'none' }); return; }
    const W = this.data.gifWidth, H = this.data.gifHeight;
    const measured = frameOps.measureText(text, this.data.textFontSize);
    const pos = frameOps.nineGridPosition(W, H, measured.w, measured.h, this.data.textGridPos);

    const texts = this.data.texts.map(t => {
      if (t.id !== id) return t;
      return {
        ...t,
        text: text,
        fontSize: this.data.textFontSize,
        color: TEXT_COLORS[this.data.textColorIndex].value,
        colorIndex: this.data.textColorIndex,
        opacity: this.data.textOpacity,
        stroke: this.data.textStroke,
        gridPos: this.data.textGridPos,
        x: pos.x, y: pos.y,
        frameScope: this.data.textFrameScope,
        rangeStart: this.data.textFrameScope === 'range' ? this.data.textRangeStart : 0,
        rangeEnd: this.data.textFrameScope === 'range' ? this.data.textRangeEnd : this._frames.length - 1
      };
    });
    this.setData({ texts, editingTextId: null, textInput: '' });
    this._renderStaticFrame(this.data.currentFrame);
  },

  deleteText(e) {
    const id = e.currentTarget.dataset.id;
    const texts = this.data.texts.filter(t => t.id !== id);
    this.setData({ texts, editingTextId: null, textInput: '' });
    this._renderStaticFrame(this.data.currentFrame);
  },

  cancelEditText() {
    this.setData({ editingTextId: null, textInput: '' });
  },

  // 文字拖拽
  onTextTouchStart(e) {
    const id = e.currentTarget.dataset.id;
    const t = this.data.texts.find(x => x.id === id);
    if (!t || e.touches.length !== 1) return;
    this._textDrag = {
      id,
      startX: e.touches[0].x,
      startY: e.touches[0].y,
      origX: t.x,
      origY: t.y
    };
  },

  onTextTouchMove(e) {
    if (!this._textDrag || e.touches.length !== 1) return;
    const scale = 1 / (this._canvasScale || 1);
    const dx = Math.round((e.touches[0].x - this._textDrag.startX) * scale);
    const dy = Math.round((e.touches[0].y - this._textDrag.startY) * scale);
    const texts = this.data.texts.map(t => {
      if (t.id !== this._textDrag.id) return t;
      return { ...t, x: this._textDrag.origX + dx, y: this._textDrag.origY + dy };
    });
    this.setData({ texts });
  },

  onTextTouchEnd() {
    this._textDrag = null;
    this._renderStaticFrame(this.data.currentFrame);
  },

  // 判断某条文字是否应用于指定帧
  _textAppliesToFrame(text, frameIdx) {
    if (text.frameScope === 'all') return true;
    return frameIdx >= text.rangeStart && frameIdx <= text.rangeEnd;
  },

  // 在 canvas ctx 上绘制文字
  _drawTexts(ctx, frameIdx) {
    for (const t of this.data.texts) {
      if (!this._textAppliesToFrame(t, frameIdx)) continue;
      ctx.save();
      ctx.globalAlpha = t.opacity;
      ctx.font = `bold ${t.fontSize}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      if (t.stroke) {
        ctx.lineWidth = Math.max(2, Math.round(t.fontSize / 6));
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(t.text, t.x, t.y);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  },

  /* ---------------- 擦除（当前帧 / 全部帧） ---------------- */

  setEraserSize(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({ eraserSizeIndex: idx, eraserSize: ERASER_SIZES[idx] });
  },

  setEraseScope(e) {
    const scope = e.currentTarget.dataset.scope;
    if (scope !== 'current' && scope !== 'all') return;
    this.setData({ eraseScope: scope });
  },

  onEraseTouchStart(e) {
    if (!this.data.eraserActive || e.touches.length !== 1) return;
    this._eraseActive = true;
    this._eraseLastPos = null;
    this._beginEraseStroke();
    this._eraseAt(e.touches[0]);
  },

  onEraseTouchMove(e) {
    if (!this._eraseActive || !this.data.eraserActive || e.touches.length !== 1) return;
    // 插值：在上一点和当前点之间擦除，避免快速滑动产生间隙
    if (this._eraseLastPos) {
      const cur = this._touchToCanvas(e.touches[0]);
      const prev = this._eraseLastPos;
      const dist = Math.sqrt((cur.x - prev.x) ** 2 + (cur.y - prev.y) ** 2);
      const steps = Math.max(1, Math.ceil(dist / (this.data.eraserSize / 2)));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        this._eraseAtPoint(
          Math.round(prev.x + (cur.x - prev.x) * t),
          Math.round(prev.y + (cur.y - prev.y) * t)
        );
      }
      this._eraseLastPos = cur;
      // 节流重绘：涂抹时痕迹实时可见（touchend 有最终全量重绘兜底）
      const now = Date.now();
      if (!this._lastEraseRenderAt || now - this._lastEraseRenderAt >= 80) {
        this._lastEraseRenderAt = now;
        this._renderStaticFrame(this.data.currentFrame);
      }
    } else {
      this._eraseAt(e.touches[0]);
    }
  },

  onEraseTouchEnd() {
    if (!this._eraseActive) return;
    this._eraseActive = false;
    this._eraseLastPos = null;
    this._commitEraseStroke();
    this._updateEraseButtons();
    this._renderStaticFrame(this.data.currentFrame);
  },

  _touchToCanvas(touch) {
    // canvas 组件的 touch 事件坐标本就相对 canvas 元素（同 pages/aiEraser 的已验证模式），
    // 不能再减 boundingClientRect 的 left/top——否则笔画整体偏左上甚至落在画布外。
    const scale = 1 / (this._canvasScale || 1); // CSS px → 画布像素
    return {
      x: Math.round(touch.x * scale),
      y: Math.round(touch.y * scale)
    };
  },

  _eraseAt(touch) {
    const pos = this._touchToCanvas(touch);
    this._eraseAtPoint(pos.x, pos.y);
    this._eraseLastPos = pos;
    // 实时更新画布（不每帧都 setData，直接重绘）
    this._renderStaticFrame(this.data.currentFrame);
  },

  _eraseAtPoint(cx, cy) {
    const r = Math.round(this.data.eraserSize / 2);
    const W = this.data.gifWidth, H = this.data.gifHeight;
    if (this._strokeScope === 'all') {
      // 全部帧模式：同一笔画应用到每一帧（frame:-1 标记，草稿重放时展开）
      let touched = false;
      for (let i = 0; i < this._frames.length; i++) {
        const bbox = frameOps.eraseCircle(this._frames[i].rgba, W, H, cx, cy, r);
        if (bbox) { touched = true; this._unionStrokeBBox(bbox); }
      }
      if (!touched) return;
      if (!this._eraseStrokes) this._eraseStrokes = [];
      this._eraseStrokes.push({ frame: -1, cx, cy, r });
      this._scheduleDraftSave();
    } else {
      // 笔画期间锁定起笔帧（防多指误触中途换帧导致基底错位）
      const frame = this._frames[this._strokeFrameIdx];
      if (!frame) return;
      const bbox = frameOps.eraseCircle(frame.rgba, W, H, cx, cy, r);
      if (!bbox) return;
      this._unionStrokeBBox(bbox);
      if (!this._eraseStrokes) this._eraseStrokes = [];
      this._eraseStrokes.push({ frame: this._strokeFrameIdx, cx, cy, r });
      this._scheduleDraftSave();
    }
  },

  // 笔画起笔：采集受影响帧的擦除前完整副本（commit 后即释放，全部帧模式瞬态 N×帧字节）。
  // 作用域与起笔帧在起笔时锁定（_strokeScope/_strokeFrameIdx），防止笔画中途
  // 多指误触切换作用域 chip / 帧缩略图导致基底与消费端错位。
  _beginEraseStroke() {
    this._strokeBBox = null;
    this._strokeSeq = (this._strokeSeq || 0) + 1;
    this._strokeScope = this.data.eraseScope;
    if (this._strokeScope === 'all') {
      this._strokeBase = this._frames.map(f => frameOps.cloneFrame(f.rgba));
      this._strokeFrameIdx = -1;
    } else {
      this._strokeFrameIdx = this.data.currentFrame;
      const frame = this._frames[this._strokeFrameIdx];
      this._strokeBase = frame ? frameOps.cloneFrame(frame.rgba) : null;
    }
  },

  // 防御性丢弃未收笔的笔画状态（不产生撤销 entry，已被擦除的像素保留）。
  // 触点：离开擦除模式（模式 tab 被第二指误触→canvas 动态绑定重渲染、收笔事件不再送达）、
  // 重新选择、加载新文件——否则 'all' 作用域的 _strokeBase（全帧完整副本，最坏 ~55MB）悬挂。
  _abortEraseStroke() {
    this._strokeBase = null;
    this._strokeBBox = null;
    this._eraseActive = false;
    this._eraseLastPos = null;
  },

  _unionStrokeBBox(bbox) {
    if (!this._strokeBBox) {
      this._strokeBBox = { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h };
      return;
    }
    const b = this._strokeBBox;
    const x2 = Math.max(b.x + b.w, bbox.x + bbox.w);
    const y2 = Math.max(b.y + b.h, bbox.y + bbox.h);
    b.x = Math.min(b.x, bbox.x);
    b.y = Math.min(b.y, bbox.y);
    b.w = x2 - b.x;
    b.h = y2 - b.y;
  },

  // 笔画收笔：把擦除前副本转成笔画包围盒区域快照压入各受影响帧的撤销栈。
  // 存量 bug 修复：旧实现在 touchend 压入擦除后整帧快照，undo pop 回同状态 = 空操作；
  // 现改为 touchstart 采集擦除前像素、touchend 入栈，撤销真正可回退。
  _commitEraseStroke() {
    if (!this._strokeBBox || !this._strokeBase) {
      this._strokeBase = null;
      this._strokeBBox = null;
      return;
    }
    const bbox = this._strokeBBox;
    const strokeId = this._strokeSeq;
    const W = this.data.gifWidth, H = this.data.gifHeight;
    if (this._strokeScope === 'all') {
      for (let i = 0; i < this._frames.length; i++) {
        this._pushFrameUndo(this._frames[i], this._strokeBase[i], bbox, strokeId, W, H);
      }
    } else {
      const frame = this._frames[this._strokeFrameIdx];
      if (frame) this._pushFrameUndo(frame, this._strokeBase, bbox, strokeId, W, H);
    }
    this._strokeBase = null;
    this._strokeBBox = null;
  },

  _pushFrameUndo(frame, baseRgba, bbox, strokeId, W, H) {
    if (!frame || !baseRgba || baseRgba.length !== frame.rgba.length) return;
    const snap = frameOps.snapshotRect(baseRgba, W, H, bbox.x, bbox.y, bbox.w, bbox.h);
    frame.undoStack.push({ x: snap.x, y: snap.y, w: snap.w, h: snap.h, data: snap.data, strokeId: strokeId });
    if (frame.undoStack.length > UNDO_LIMIT) frame.undoStack.shift();
    frame.redoStack = [];
  },

  // 恢复 entry 到 frame，并把 frame 当前区域捕获进 direction 对应的栈（undo↔redo 互逆）
  _restoreEntry(frame, entry, direction) {
    const W = this.data.gifWidth, H = this.data.gifHeight;
    if (!frame || !entry || frame.rgba.length !== W * H * 4) return;
    const current = frameOps.snapshotRect(frame.rgba, W, H, entry.x, entry.y, entry.w, entry.h);
    frameOps.restoreRect(frame.rgba, W, entry);
    const stack = direction === 'redo' ? frame.redoStack : frame.undoStack;
    stack.push({ x: current.x, y: current.y, w: current.w, h: current.h, data: current.data, strokeId: entry.strokeId });
    if (stack.length > UNDO_LIMIT) stack.shift();
  },

  // 全部帧笔画（同 strokeId）在其他帧栈中的联动 entry（可能压在栈中间，splice 取出）
  _pullLinkedEntry(frame, strokeId, stackName) {
    const stack = frame[stackName];
    const idx = stack.findIndex(en => en.strokeId === strokeId);
    return idx >= 0 ? stack.splice(idx, 1)[0] : null;
  },

  undoErase() {
    const frame = this._frames[this.data.currentFrame];
    if (!frame || frame.undoStack.length === 0) return;
    const entry = frame.undoStack.pop();
    this._restoreEntry(frame, entry, 'redo');
    // 全部帧笔画：其他帧同笔联动回退
    if (entry.strokeId !== undefined) {
      for (let i = 0; i < this._frames.length; i++) {
        if (i === this.data.currentFrame) continue;
        const linked = this._pullLinkedEntry(this._frames[i], entry.strokeId, 'undoStack');
        if (linked) this._restoreEntry(this._frames[i], linked, 'redo');
      }
    }
    this._updateEraseButtons();
    this._renderStaticFrame(this.data.currentFrame);
  },

  redoErase() {
    const frame = this._frames[this.data.currentFrame];
    if (!frame || frame.redoStack.length === 0) return;
    const entry = frame.redoStack.pop();
    this._restoreEntry(frame, entry, 'undo');
    if (entry.strokeId !== undefined) {
      for (let i = 0; i < this._frames.length; i++) {
        if (i === this.data.currentFrame) continue;
        const linked = this._pullLinkedEntry(this._frames[i], entry.strokeId, 'redoStack');
        if (linked) this._restoreEntry(this._frames[i], linked, 'undo');
      }
    }
    this._updateEraseButtons();
    this._renderStaticFrame(this.data.currentFrame);
  },

  _updateEraseButtons() {
    const frame = this._frames && this._frames[this.data.currentFrame];
    this.setData({
      canUndoErase: !!(frame && frame.undoStack.length > 0),
      canRedoErase: !!(frame && frame.redoStack.length > 0)
    });
  },

  switchEraseFrame(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({ currentFrame: idx });
    this._updateEraseButtons();
    this._renderStaticFrame(idx);
  },

  /* ---------------- 预览渲染 ---------------- */

  _renderStaticFrame(frameIdx) {
    if (!this._frames || !this._frames[frameIdx]) return;
    const frame = this._frames[frameIdx];
    const query = wx.createSelectorQuery().in(this);
    query.select('#previewCanvas').fields({ node: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      try {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        if (canvas.width !== this.data.gifWidth) {
          canvas.width = this.data.gifWidth;
          canvas.height = this.data.gifHeight;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const imgData = ctx.createImageData(this.data.gifWidth, this.data.gifHeight);
        imgData.data.set(frame.rgba);
        ctx.putImageData(imgData, 0, 0);
        // 绘制文字
        this._drawTexts(ctx, frameIdx);
      } catch (e) {
        console.error('渲染失败', e);
      }
    });
  },

  togglePreview() {
    if (this.data.previewPlaying) this._stopPreview();
    else this._startPreview();
  },

  _startPreview() {
    if (!this._frames || this._frames.length === 0) return;
    if (this.data.mode !== 'edit') {
      // 在非编辑模式下不允许播放
      this.setData({ mode: 'edit', cropActive: false, eraserActive: false });
    }
    this._lastFrameSyncAt = 0;
    this.setData({ previewPlaying: true });
    this._renderPlaybackFrame(0);
  },

  _stopPreview() {
    if (this._previewTimer) {
      clearTimeout(this._previewTimer);
      this._previewTimer = null;
    }
    this.setData({ previewPlaying: false });
  },

  _renderPlaybackFrame(frameIdx) {
    if (!this.data.previewPlaying) return;
    if (!this._frames || this._frames.length === 0) return;

    const idx = frameIdx % this._frames.length;
    const frame = this._frames[idx];

    const query = wx.createSelectorQuery().in(this);
    query.select('#previewCanvas').fields({ node: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      try {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        if (canvas.width !== this.data.gifWidth) {
          canvas.width = this.data.gifWidth;
          canvas.height = this.data.gifHeight;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const imgData = ctx.createImageData(this.data.gifWidth, this.data.gifHeight);
        imgData.data.set(frame.rgba);
        ctx.putImageData(imgData, 0, 0);
        this._drawTexts(ctx, idx);
      } catch (e) { console.error('播放渲染失败', e); }
    });

    // 节流同步 currentFrame 到 data：每帧 setData（最高 50Hz）会触发频繁 setData 告警，
    // 帧号提示 ~4Hz 足够，画布渲染不受影响
    const now = Date.now();
    if (!this._lastFrameSyncAt || now - this._lastFrameSyncAt >= 250) {
      this._lastFrameSyncAt = now;
      this.setData({ currentFrame: idx });
    }
    const delay = Math.max(20, Math.round(frame.delayMs / this.data.speed));
    this._previewTimer = setTimeout(() => this._renderPlaybackFrame(idx + 1), delay);
  },

  /* ---------------- 导出 ---------------- */

  async exportGif() {
    if (this.data.exporting) return;
    if (!this._frames || this._frames.length === 0) {
      wx.showToast({ title: '没有可导出的帧', icon: 'none' });
      return;
    }
    const exportStartTime = Date.now();
    const sourceSize = this._sourceSize || 0;

    this._cancelled = false;
    this._stopPreview();
    this.setData({
      exporting: true,
      progress: 0,
      progressText: '准备导出...',
      resultPath: '',
      resultSize: 0
    });

    try {
      await this._yield();

      const W = this.data.gifWidth;
      const H = this.data.gifHeight;
      const speed = this.data.speed;
      const hasTexts = this.data.texts.length > 0;

      // 获取合成画布（用于文字烘焙）
      let compCanvas = null, compCtx = null;
      if (hasTexts) {
        compCanvas = await this._getCanvasNode('#exportCanvas');
        if (compCanvas) {
          compCanvas.width = W;
          compCanvas.height = H;
          compCtx = compCanvas.getContext('2d');
        }
      }

      const frames = [];
      for (let i = 0; i < this._frames.length; i++) {
        if (this._cancelled) return;
        const f = this._frames[i];

        let rgba = f.rgba;
        if (hasTexts && compCtx) {
          // 烘焙文字到帧像素
          compCtx.clearRect(0, 0, W, H);
          const imgData = compCtx.createImageData(W, H);
          imgData.data.set(f.rgba);
          compCtx.putImageData(imgData, 0, 0);
          this._drawTextsOnContext(compCtx, i);
          const composited = compCtx.getImageData(0, 0, W, H);
          rgba = new Uint8Array(composited.data);
        }

        frames.push({
          width: W,
          height: H,
          rgba: rgba,
          delayCs: Math.max(2, Math.round(f.delayMs / 10 / speed))
        });

        this.setData({
          progress: Math.round((i / this._frames.length) * 60),
          progressText: `合成帧 ${i + 1}/${this._frames.length}`
        });
        await this._yield();
      }

      this.setData({ progress: 65, progressText: this.data.compressEnabled ? '压缩中...' : (this.data.useAdaptive ? '自适应调色板编码中...' : '差量编码中...') });
      await this._yield();

      let gifBytes;
      if (this.data.compressEnabled && this.data.targetSize > 0) {
        // 目标体积压缩
        const targetBytes = Math.round(this.data.sizeUnit === 'KB'
          ? this.data.targetSize * 1024
          : this.data.targetSize * 1024 * 1024);
        const compressFrames = frames.map(f => ({
          rgba: f.rgba,
          delayMs: f.delayCs * 10,
          width: W,
          height: H
        }));
        const result = compressGif(compressFrames, W, H, targetBytes, {
          loop: 0,
          onProgress: (level, total) => {
            this.setData({
              progress: 65 + Math.round(level / total * 25),
              progressText: `压缩中 ${level}/${total}`
            });
          }
        });
        gifBytes = result.bytes;
      } else {
        if (this.data.compressEnabled) {
          // 开了压缩但目标体积无效（空/0/NaN）——不静默降级，明示用户
          wx.showToast({ title: '目标体积无效，已按原画质导出', icon: 'none' });
        }
        const encoder = this.data.useAdaptive ? buildGIFDiffAdaptive : buildGIFDiff;
        gifBytes = encoder(frames, { width: W, height: H, loop: 0, dither: false });
      }

      if (this._cancelled) return;

      this.setData({ progress: 90, progressText: '写入文件...' });
      await this._yield();

      const fs = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/gifEditor_${Date.now()}.gif`;
      await new Promise((resolve, reject) => {
        fs.writeFile({
          filePath,
          data: gifBytes.buffer,
          encoding: 'binary',
          success: resolve,
          fail: reject
        });
      });

      this.setData({
        progress: 100,
        progressText: '完成',
        resultPath: filePath,
        resultSize: gifBytes.length,
        resultSizeText: this._formatSize(gifBytes.length)
      });
      analytics.track('tool_complete', { toolId: 'gifEditor' });

      // 记录导出报告
      this._recordExport({
        sourceSize,
        outputSize: gifBytes.length,
        outputWidth: W,
        outputHeight: H,
        outputFrameCount: frames.length,
        durationMs: Date.now() - exportStartTime,
        compressionStrategy: this.data.compressEnabled ? 'target-size' : (this.data.useAdaptive ? 'adaptive' : 'fixed'),
        operations: this._collectOperations()
      });

      wx.showToast({ title: '导出成功', icon: 'success' });
    } catch (err) {
      console.error('GIF 导出失败', err);
      wx.showModal({
        title: '导出失败',
        content: (err && err.message) ? err.message : '未知错误，请重试',
        showCancel: false
      });
    } finally {
      this.setData({ exporting: false });
    }
  },

  _getCanvasNode(id) {
    return new Promise((resolve) => {
      wx.createSelectorQuery().in(this)
        .select(id).fields({ node: true })
        .exec((res) => {
          resolve(res && res[0] && res[0].node ? res[0].node : null);
        });
    });
  },

  // 独立的文字绘制（用于导出，不依赖 this.data 的响应式）
  _drawTextsOnContext(ctx, frameIdx) {
    for (const t of this.data.texts) {
      if (!this._textAppliesToFrame(t, frameIdx)) continue;
      ctx.save();
      ctx.globalAlpha = t.opacity;
      ctx.font = `bold ${t.fontSize}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      if (t.stroke) {
        ctx.lineWidth = Math.max(2, Math.round(t.fontSize / 6));
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(t.text, t.x, t.y);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  },

  _yield() {
    return new Promise(resolve => setTimeout(resolve, 0));
  },

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  },

  /* ---------------- 结果与保存 ---------------- */

  previewResult() {
    if (!this.data.resultPath) return;
    wx.previewImage({ current: this.data.resultPath, urls: [this.data.resultPath] });
  },

  async saveGif() {
    if (!this.data.resultPath) { wx.showToast({ title: '请先导出', icon: 'none' }); return; }
    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.resultPath);
    } catch (err) {
      console.error('保存失败', err);
      wx.showModal({
        title: '保存失败',
        content: '部分机型相册不支持保存动图。GIF 文件已生成，可重新尝试或换设备保存。',
        showCancel: false
      });
    }
  },

  resetAll() {
    if (!this._frames || this._frames.length === 0) return;
    wx.showModal({
      title: '重置',
      content: '将清除当前编辑并重新选择 GIF？',
      success: (r) => {
        if (!r.confirm) return;
        this._stopPreview();
        this._abortEraseStroke();
        this._frames = null;
        this._preCropSnapshot = null;
        this.setData({
          fileName: '', fileSizeText: '', gifWidth: 0, gifHeight: 0,
          frames: [], selectedCount: 0, selectMode: false,
          speed: 1, speedIndex: 1, mode: 'edit',
          texts: [], editingTextId: null, textInput: '',
          resultPath: '', resultSize: 0, exporting: false,
          previewPlaying: false, cropActive: false, canUndoCrop: false,
          eraserActive: false, currentFrame: 0
        });
      }
    });
  },

  // 收集当前编辑操作列表（用于报告）
  _collectOperations() {
    const ops = [];
    if (this._preCropSnapshot) ops.push('crop');
    if (this.data.texts && this.data.texts.length > 0) ops.push('text×' + this.data.texts.length);
    if (this._eraseStrokes && this._eraseStrokes.length > 0) ops.push('erase');
    if (this.data.speed !== 1) ops.push('speed:' + this.data.speed + 'x');
    if (this.data.useAdaptive) ops.push('adaptive-palette');
    if (this.data.compressEnabled && this.data.targetSize > 0) {
      ops.push('compress:' + this.data.targetSize + this.data.sizeUnit);
    }
    return ops;
  },

  // 记录导出到报告
  _recordExport(record) {
    try {
      const REPORT_KEY = 'gif_export_reports';
      let store;
      try {
        store = report.deserialize(wx.getStorageSync(REPORT_KEY));
      } catch (e) {
        store = report.createStore();
      }
      store = report.addRecord(store, Object.assign({
        id: 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        timestamp: Date.now(),
        tool: 'gifEditor',
        operations: [],
        sourceWidth: this.data.gifWidth,
        sourceHeight: this.data.gifHeight,
        sourceFrameCount: this._frames ? this._frames.length : 0,
        matchRate: 0
      }, record));
      wx.setStorageSync(REPORT_KEY, report.serialize(store));
    } catch (e) {
      console.warn('报告记录失败', e);
    }
  },

  // 分享导出文件到聊天
  shareResult() {
    if (!this.data.resultPath) return;
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath: this.data.resultPath,
        fileName: 'edited_' + Date.now() + '.gif',
        success: () => {
          analytics.track('gif_share_file', { toolId: 'gifEditor' });
        },
        fail: () => {
          // 降级：提示保存后分享
          wx.showModal({
            title: '分享',
            content: '当前微信版本不支持直接分享文件，请先保存到相册后转发。',
            showCancel: false
          });
        }
      });
    }
  },

  onShareAppMessage() {
    analytics.trackShare('gifEditor', 'friend');
    const ops = this._collectOperations();
    const title = ops.length > 0
      ? `GIF编辑完成（${ops.join('/')}）- GIF编辑器`
      : 'GIF编辑器：裁剪/文字/擦除/逐帧编辑，本地处理免联网';
    return { title, path: '/pkgGif/pages/gifEditor/gifEditor' };
  },

  onShareTimeline() {
    analytics.trackShare('gifEditor', 'timeline');
    return { title: 'GIF 裁剪/字幕/擦除/差量压缩，本地生成动图' };
  },

  /* ---------------- 自适应调色板开关 ---------------- */

  toggleAdaptive() {
    this.setData({ useAdaptive: !this.data.useAdaptive });
  },

  toggleCompress() {
    this.setData({ compressEnabled: !this.data.compressEnabled });
  },

  onTargetSize(e) {
    const v = Number(e.detail.value);
    this.setData({ targetSize: isNaN(v) ? 0 : v });
  },

  // KB/MB 切换：数值同步换算，避免「1 MB 切成 1 KB」的困惑。
  // KB→MB 留 3 位小数（1KB→0.001MB），不下限抬到 0.1MB（小目标会膨胀百倍）
  setSizeUnit(e) {
    const unit = e.currentTarget.dataset.unit;
    if (unit !== 'KB' && unit !== 'MB') return;
    if (unit === this.data.sizeUnit) return;
    let v = Number(this.data.targetSize) || 0;
    if (unit === 'KB') v = Math.max(1, Math.round(v * 1024));
    else v = Math.max(0.001, Math.round(v / 1024 * 1000) / 1000);
    this.setData({ sizeUnit: unit, targetSize: v });
  },

  /* ---------------- 拆帧导出（GIF→PNG） ---------------- */

  async exportFrames() {
    if (!this._frames || this._frames.length === 0) return;
    if (this.data.exportingFrames) return;

    const all = this.data.frames.filter(f => f.selected).map(f => f.index);
    const frameIndices = all.length > 0 ? all : this._frames.map((_, i) => i);
    const count = frameIndices.length;

    wx.showModal({
      title: '导出帧',
      content: `将 ${count} 帧保存为 PNG 到相册？`,
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ exportingFrames: true, exportFrameProgress: 0, exportFrameText: '准备中...' });
        try {
          const canvas = await this._getCanvasNode('#exportCanvas');
          if (!canvas) throw new Error('画布初始化失败');
          const ctx = canvas.getContext('2d');
          const W = this.data.gifWidth, H = this.data.gifHeight;
          canvas.width = W; canvas.height = H;

          const fs = wx.getFileSystemManager();
          let saved = 0;
          for (let i = 0; i < count; i++) {
            if (this._cancelled) break;
            const frameIdx = frameIndices[i];
            const frame = this._frames[frameIdx];

            ctx.clearRect(0, 0, W, H);
            const imgData = ctx.createImageData(W, H);
            imgData.data.set(frame.rgba);
            ctx.putImageData(imgData, 0, 0);
            this._drawTextsOnContext(ctx, frameIdx);

            this.setData({
              exportFrameProgress: Math.round((i / count) * 80),
              exportFrameText: `导出帧 ${i + 1}/${count}`
            });
            await this._yield();

            const tempPath = await new Promise((resolve, reject) => {
              wx.canvasToTempFilePath({
                canvas, x: 0, y: 0, width: W, height: H,
                destWidth: W, destHeight: H,
                fileType: 'png',
                success: res => resolve(res.tempFilePath),
                fail: reject
              });
            });

            // 复制到用户目录并命名 gifEditor_frame_001.png
            const fs = wx.getFileSystemManager();
            const frameNum = String(i + 1).padStart(3, '0');
            const namedPath = `${wx.env.USER_DATA_PATH}/gifEditor_frame_${frameNum}.png`;
            await new Promise((resolve, reject) => {
              fs.copyFile({
                srcPath: tempPath,
                destPath: namedPath,
                success: resolve,
                fail: reject
              });
            });

            // 保存到相册
            await imageProcess.saveImageToPhotosAlbum(namedPath);
            saved++;

            this.setData({
              exportFrameProgress: Math.round(((i + 1) / count) * 100),
              exportFrameText: `已保存 ${saved}/${count}`
            });
            await this._yield();
          }

          this.setData({ exportingFrames: false });
          wx.showToast({ title: `已保存 ${saved} 帧`, icon: 'success' });
          analytics.track('gif_export_frames', { toolId: 'gifEditor', count: saved });
        } catch (err) {
          console.error('拆帧导出失败', err);
          this.setData({ exportingFrames: false });
          wx.showModal({
            title: '导出失败',
            content: (err && err.errMsg) || (err && err.message) || '部分帧保存失败，请检查相册权限。',
            showCancel: false
          });
        }
      }
    });
  },

  /* ---------------- GIF 信息面板 ---------------- */

  toggleInfoPanel() {
    if (this.data.showInfoPanel) {
      this.setData({ showInfoPanel: false });
      return;
    }
    if (!this._frames) return;

    const delays = this._frames.map(f => f.delayMs);
    const minDelay = Math.min.apply(null, delays);
    const maxDelay = Math.max.apply(null, delays);
    const avgDelay = Math.round(delays.reduce((s, d) => s + d, 0) / delays.length);
    const totalDuration = delays.reduce((s, d) => s + d, 0);

    // GIF 版本（从源文件头读取，若可用）
    let version = 'GIF89a';
    if (this._gifHeader) {
      version = this._gifHeader;
    }

    const info = {
      version,
      width: this.data.gifWidth,
      height: this.data.gifHeight,
      frameCount: this._frames.length,
      minDelay,
      maxDelay,
      avgDelay,
      totalDuration: (totalDuration / 1000).toFixed(1) + 's',
      fileSize: this.data.fileSizeText,
      quantization: this.data.useAdaptive ? '自适应调色板' : '固定 6×6×6 色板',
      loopCount: this.data.loopCount
    };
    this.setData({ showInfoPanel: true, infoData: info });
  },

  closeInfoPanel() {
    this.setData({ showInfoPanel: false });
  },

  /* ---------------- 编辑草稿持久化 ---------------- */
  // 策略：保存源文件副本 + 操作日志（文字/裁剪/调速/帧序/擦除笔画）
  // 不保存完整 RGBA 帧数据（超出 1MB/key 限制），擦除以笔画列表重放
  // 容量：操作日志通常 <10KB，源文件另存为独立文件

  _checkDraft() {
    try {
      const draft = wx.getStorageSync(DRAFT_KEY);
      if (draft && draft.savedAt) {
        const age = Date.now() - draft.savedAt;
        // 草稿 24 小时内有效
        if (age < 24 * 60 * 60 * 1000) {
          this._pendingDraft = draft;
          this.setData({ hasDraft: true });
        }
      }
    } catch (e) { /* ignore */ }
  },

  restoreDraft() {
    const draft = this._pendingDraft;
    if (!draft) return;
    wx.showModal({
      title: '恢复草稿',
      content: '检测到未完成的编辑，是否恢复？',
      success: async (r) => {
        if (!r.confirm) {
          this._discardDraft();
          return;
        }
        try {
          const sourcePath = `${wx.env.USER_DATA_PATH}/${DRAFT_SOURCE}`;
          // 复用加载流程（会重新解码、生成缩略图）
          await this._loadGifFile(sourcePath, 0, draft.fileName || 'draft.gif', { skipSourceSave: true });

          // 重放操作
          if (draft.speed) {
            const idx = SPEED_OPTIONS.findIndex(s => s.value === draft.speed);
            if (idx >= 0) this.setData({ speed: draft.speed, speedIndex: idx });
          }
          if (draft.texts && draft.texts.length) this.setData({ texts: draft.texts });
          if (draft.useAdaptive) this.setData({ useAdaptive: true });

          // 裁剪先于擦除重放：_applyCrop 落笔时即清空 _eraseStrokes，故草稿里的
          // 笔画全部是裁剪后坐标系（无 crop 则是原始坐标系）——先裁剪再重放才能对齐
          // （旧序在原始尺寸上重放后再裁剪，坐标整体错位甚至静默丢失）。
          if (draft.crop) {
            const oldW = this.data.gifWidth, oldH = this.data.gifHeight;
            for (let i = 0; i < this._frames.length; i++) {
              const f = this._frames[i];
              f.rgba = frameOps.cropFrame(f.rgba, oldW, oldH,
                draft.crop.x, draft.crop.y, draft.crop.w, draft.crop.h);
              f.thumbPath = '';
            }
            this._preCropSnapshot = null;
            this._cropState = draft.crop;
            this.setData({ gifWidth: draft.crop.w, gifHeight: draft.crop.h, canUndoCrop: false });
            this._syncFrames();
            this._lazyGenerateThumbs(0);
          }

          // 擦除笔画重放（坐标与当前帧尺寸一致）
          if (draft.eraseStrokes && Array.isArray(draft.eraseStrokes)) {
            const W = this.data.gifWidth, H = this.data.gifHeight;
            for (const stroke of draft.eraseStrokes) {
              if (stroke.frame === -1) {
                // 全部帧笔画：展开到每一帧
                for (let i = 0; i < this._frames.length; i++) {
                  frameOps.eraseCircle(this._frames[i].rgba, W, H,
                    stroke.cx, stroke.cy, stroke.r);
                }
              } else {
                const frame = this._frames[stroke.frame];
                if (frame) {
                  frameOps.eraseCircle(frame.rgba, W, H,
                    stroke.cx, stroke.cy, stroke.r);
                }
              }
            }
            // 重放后登记笔画列表：后续 _saveDraft 才不会把已擦效果丢掉
            // （rgba 不入库，草稿恢复完全依赖源文件 + 笔画重放）
            this._eraseStrokes = draft.eraseStrokes.slice();
          }

          this._discardDraft();
          setTimeout(() => {
            this._queryCanvasSize();
            this._renderStaticFrame(0);
          }, 50);
          wx.showToast({ title: '草稿已恢复', icon: 'success' });
        } catch (e) {
          console.error('恢复草稿失败', e);
          wx.showToast({ title: '草稿恢复失败', icon: 'none' });
          this._discardDraft();
        }
      }
    });
  },

  _discardDraft() {
    try {
      wx.removeStorageSync(DRAFT_KEY);
      this._pendingDraft = null;
      this.setData({ hasDraft: false });
    } catch (e) { /* ignore */ }
  },

  _saveDraft() {
    if (!this._frames || this._frames.length === 0) return;
    try {
      // 收集擦除笔画（从 undoStack 差异推断不可行，改为在擦除时记录）
      const draft = {
        savedAt: Date.now(),
        fileName: this.data.fileName,
        fileSize: 0,
        speed: this.data.speed,
        texts: this.data.texts,
        useAdaptive: this.data.useAdaptive,
        frameOrder: null, // 如果帧序被修改，记录索引映射
        eraseStrokes: this._eraseStrokes || [],
        crop: this._cropState || null
      };
      wx.setStorageSync(DRAFT_KEY, draft);
    } catch (e) {
      console.warn('草稿保存失败', e);
    }
  },

  // 异步写源文件副本（同步 writeFileSync 会阻塞逻辑线程数 MB、数十至数百 ms）
  _saveSourceToStorage(buffer) {
    return new Promise((resolve) => {
      try {
        const fs = wx.getFileSystemManager();
        const path = `${wx.env.USER_DATA_PATH}/${DRAFT_SOURCE}`;
        fs.writeFile({ filePath: path, data: buffer, encoding: 'binary', success: resolve, fail: resolve });
      } catch (e) {
        console.warn('源文件保存失败', e);
        resolve();
      }
    });
  },

  // 在编辑操作后调用（节流）
  _scheduleDraftSave() {
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => this._saveDraft(), 1000);
  }
});
