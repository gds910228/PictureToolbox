// pages/makeGif/makeGif.js
// GIF 制作：多图选择 → 顺序调整 → 帧时长/字幕/尺寸 → 本地编码 → 预览/保存
// 全程前端本地实现，不依赖外部 API。编码逻辑见 utils/gif-encoder.js（已用 omggif 交叉验证）。
const imageProcess = require('../../utils/image-process');
const { buildGIF } = require('../../utils/gif-encoder');
const analytics = require('../../utils/analytics');

const MAX_IMAGES = 20;
const MIN_IMAGES = 2;
const SRC_MAX_EDGE = 720;       // 源图最长边压缩上限（控制解码内存）
// 输出像素预算上限（W*H*帧数）。超出则提示用户缩图或减张，避免内存压力。
const PIXEL_BUDGET = 480 * 480 * 20; // ≈ 460 万像素

// 输出尺寸档（最长边像素）
const SIZE_OPTIONS = [
  { value: 240, label: '240' },
  { value: 360, label: '360' },
  { value: 480, label: '480' }
];
// 宽高比档
const ASPECT_OPTIONS = [
  { value: '1:1', label: '1:1', w: 1, h: 1 },
  { value: '4:3', label: '4:3', w: 4, h: 3 },
  { value: '16:9', label: '16:9', w: 16, h: 9 }
];

Page({
  data: {
    images: [],              // [{ path }]
    selectedIndex: -1,       // 当前选中（用于排序/删除）
    aspect: '1:1',
    outSize: 360,
    delayMs: 500,
    delayText: '500 毫秒',
    loop: true,
    dither: true,
    subtitle: '',            // 字幕文本
    subtitlePos: 'bottom',   // top | bottom
    subtitleSize: 'medium',  // small | medium | large
    // 编码
    generating: false,
    progress: 0,
    progressText: '',
    // 结果
    resultPath: '',
    resultSize: 0,
    resultSizeText: '',
    // 选项（供 wxml 渲染）
    sizeOptions: SIZE_OPTIONS,
    aspectOptions: ASPECT_OPTIONS,
    maxImages: MAX_IMAGES,
    minImages: MIN_IMAGES
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'makeGif' });
  },
  onUnload() {
    this._cancelled = true;
  },

  /* ---------------- 图片选择与排序 ---------------- */

  async addImages() {
    if (this.data.images.length >= MAX_IMAGES) {
      wx.showToast({ title: `最多 ${MAX_IMAGES} 张`, icon: 'none' });
      return;
    }
    const remain = MAX_IMAGES - this.data.images.length;
    try {
      const paths = await imageProcess.chooseImage(remain, ['original', 'compressed'], ['album', 'camera']);
      if (!paths || !paths.length) return;
      wx.showLoading({ title: '处理图片...', mask: true });
      const newOnes = [];
      for (const p of paths) {
        const compressed = await this._compressSrc(p);
        newOnes.push({ path: compressed });
      }
      wx.hideLoading();
      const images = this.data.images.concat(newOnes);
      this.setData({
        images,
        selectedIndex: images.length - 1,
        resultPath: '',
        resultSize: 0
      });
    } catch (err) {
      wx.hideLoading();
      if (err && err.errMsg && /cancel/i.test(err.errMsg)) return;
      console.error('选择图片失败', err);
      wx.showToast({ title: '选择失败', icon: 'none' });
    }
  },

  // 源图压缩：最长边限定 SRC_MAX_EDGE，控制 canvas.createImage 的解码内存
  async _compressSrc(filePath) {
    try {
      const info = await imageProcess.getImageInfo(filePath);
      const longest = Math.max(info.width, info.height);
      if (longest <= SRC_MAX_EDGE) return filePath; // 无需压缩
      const opt = info.width >= info.height
        ? { compressedWidth: SRC_MAX_EDGE }
        : { compressedHeight: SRC_MAX_EDGE };
      const res = await new Promise((resolve, reject) => {
        wx.compressImage(Object.assign({ src: filePath, quality: 80 }, opt, {
          success: (r) => resolve(r.tempFilePath),
          fail: reject
        }));
      });
      return res;
    } catch (e) {
      return filePath; // 压缩失败回退原图
    }
  },

  tapImage(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ selectedIndex: index });
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.slice();
    images.splice(index, 1);
    let sel = this.data.selectedIndex;
    if (sel === index) sel = -1;
    else if (sel > index) sel -= 1;
    this.setData({ images, selectedIndex: sel, resultPath: '', resultSize: 0 });
  },

  moveSelected(delta) {
    const i = this.data.selectedIndex;
    const j = i + delta;
    const images = this.data.images;
    if (i < 0 || j < 0 || j >= images.length) return;
    const arr = images.slice();
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    this.setData({ images: arr, selectedIndex: j, resultPath: '', resultSize: 0 });
  },
  moveLeft() { this.moveSelected(-1); },
  moveRight() { this.moveSelected(1); },

  clearAll() {
    if (!this.data.images.length) return;
    wx.showModal({
      title: '清空', content: '确定清空所有图片？',
      success: (r) => {
        if (r.confirm) this.setData({ images: [], selectedIndex: -1, resultPath: '', resultSize: 0 });
      }
    });
  },

  /* ---------------- 参数设置 ---------------- */

  setAspect(e) { this.setData({ aspect: e.currentTarget.dataset.value, resultPath: '', resultSize: 0 }); },
  setOutSize(e) { this.setData({ outSize: Number(e.currentTarget.dataset.value), resultPath: '', resultSize: 0 }); },
  // 帧时长：拖动中只更新读数（避免每 tick 清结果），松手时提交并失效旧结果
  onDelayChanging(e) {
    this.setData({ delayText: this._msToText(e.detail.value) });
  },
  onDelayChange(e) {
    this.setData({ delayMs: e.detail.value, delayText: this._msToText(e.detail.value), resultPath: '', resultSize: 0 });
  },
  _msToText(ms) {
    if (ms < 1000) return ms + ' 毫秒';
    const s = ms / 1000;
    return (Number.isInteger(s) ? String(s) : s.toFixed(2).replace(/\.?0+$/, '')) + ' 秒';
  },
  toggleLoop(e) { this.setData({ loop: e.detail.value, resultPath: '', resultSize: 0 }); },
  toggleDither(e) { this.setData({ dither: e.detail.value, resultPath: '', resultSize: 0 }); },
  onSubtitleInput(e) { this.setData({ subtitle: e.detail.value, resultPath: '', resultSize: 0 }); },
  setSubtitlePos(e) { this.setData({ subtitlePos: e.currentTarget.dataset.value, resultPath: '', resultSize: 0 }); },
  setSubtitleSize(e) { this.setData({ subtitleSize: e.currentTarget.dataset.value, resultPath: '', resultSize: 0 }); },

  // 依据宽高比与最长边计算输出宽高
  _outputDims() {
    const a = ASPECT_OPTIONS.find(o => o.value === this.data.aspect) || ASPECT_OPTIONS[0];
    const longest = this.data.outSize;
    let w, h;
    if (a.w >= a.h) { w = longest; h = Math.round(longest * a.h / a.w); }
    else { h = longest; w = Math.round(longest * a.w / a.h); }
    // 宽高对齐到偶数（避免某些解码器奇数尺寸问题）
    w = w - (w % 2); h = h - (h % 2);
    return { w: Math.max(2, w), h: Math.max(2, h) };
  },

  /* ---------------- 生成 GIF ---------------- */

  async generate() {
    if (this.data.generating) return;
    const count = this.data.images.length;
    if (count < MIN_IMAGES) {
      wx.showToast({ title: `至少 ${MIN_IMAGES} 张图片`, icon: 'none' });
      return;
    }

    const { w: W, h: H } = this._outputDims();
    // 像素预算检查
    const totalPx = W * H * count;
    if (totalPx > PIXEL_BUDGET) {
      wx.showModal({
        title: '输出过大',
        content: `当前组合约 ${(totalPx / 1e6).toFixed(1)} 百万像素，可能占用内存过高。\n建议缩小输出尺寸或减少图片数量。`,
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    this._cancelled = false;
    this.setData({
      generating: true, progress: 0, progressText: '准备画布...', resultPath: '', resultSize: 0
    });

    try {
      const canvas = await this._getCanvas();
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (typeof ctx.getImageData !== 'function') {
        throw new Error('当前微信版本不支持像素读取，请升级微信');
      }

      const frames = [];
      const imgs = this.data.images;
      const subtitle = this.data.subtitle.trim();

      for (let i = 0; i < imgs.length; i++) {
        if (this._cancelled) return;
        this.setData({ progressText: `生成中 ${i + 1}/${imgs.length}` });

        const img = await this._loadImage(canvas, imgs[i].path);
        // cover 裁剪绘制
        const iw = img.width, ih = img.height;
        const scale = Math.max(W / iw, H / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

        // 字幕
        if (subtitle) this._drawSubtitle(ctx, W, H, subtitle);

        const imgData = ctx.getImageData(0, 0, W, H);
        frames.push({
          width: W, height: H,
          rgba: imgData.data,
          delayCs: Math.max(2, Math.round(this.data.delayMs / 10))
        });

        // 释放并让出主线程，避免长时间阻塞
        img.src = '';
        await this._yield();

        this.setData({ progress: Math.round(((i + 1) / imgs.length) * 90) });
      }

      if (this._cancelled) return;
      this.setData({ progressText: '编码中...' });

      // 编码（同步、较重；先让 UI 更新到"编码中"）
      await this._yield();
      const gifBytes = buildGIF(frames, {
        width: W, height: H,
        loop: this.data.loop ? 0 : null,
        dither: this.data.dither
      });

      // 写入用户目录文件
      const fs = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/makeGif_${Date.now()}.gif`;
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
      analytics.track('tool_complete', { toolId: 'makeGif' });
      wx.showToast({ title: '生成成功', icon: 'success' });
    } catch (err) {
      console.error('GIF 生成失败', err);
      wx.showModal({
        title: '生成失败',
        content: (err && err.message) ? err.message : '未知错误，请重试',
        showCancel: false
      });
    } finally {
      this.setData({ generating: false });
    }
  },

  _getCanvas() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#gifCanvas')
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

  // 字幕绘制：白字黑描边，自适应缩放，单行
  _drawSubtitle(ctx, W, H, text) {
    const sizeMap = { small: W / 18, medium: W / 12, large: W / 9 };
    let fontSize = Math.round(sizeMap[this.data.subtitleSize] || sizeMap.medium);
    const pad = Math.round(W * 0.05);
    ctx.textAlign = 'center';
    ctx.lineWidth = Math.max(2, Math.round(fontSize / 5));
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#FFFFFF';
    // 自适应：过宽则缩字号，下限 W/24
    const minFont = Math.max(10, Math.round(W / 24));
    let label = text;
    while (fontSize > minFont) {
      ctx.font = `bold ${fontSize}px sans-serif`;
      if (ctx.measureText(label).width <= W - pad * 2) break;
      fontSize -= 1;
    }
    // 仍超宽则截断
    ctx.font = `bold ${fontSize}px sans-serif`;
    while (ctx.measureText(label + '…').width > W - pad * 2 && label.length > 1) {
      label = label.slice(0, -1);
    }
    if (label !== text) label = label + '…';
    let y;
    if (this.data.subtitlePos === 'top') {
      ctx.textBaseline = 'top';
      y = pad;
    } else {
      ctx.textBaseline = 'bottom';
      y = H - pad;
    }
    ctx.strokeText(label, W / 2, y);
    ctx.fillText(label, W / 2, y);
  },

  _yield() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  },

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  },

  /* ---------------- 预览与保存 ---------------- */

  previewImage() {
    if (!this.data.resultPath) return;
    wx.previewImage({ current: this.data.resultPath, urls: [this.data.resultPath] });
  },

  async saveGif() {
    if (!this.data.resultPath) {
      wx.showToast({ title: '请先生成', icon: 'none' });
      return;
    }
    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.resultPath);
    } catch (err) {
      console.error('保存失败', err);
      // 相册保存失败时，文件仍在用户目录，提示可重试
      wx.showModal({
        title: '保存失败',
        content: '部分机型相册不支持保存动图。GIF 文件已生成，可重新尝试或换设备保存。',
        showCancel: false
      });
    }
  },

  onShareAppMessage() {
    analytics.trackShare('makeGif', 'friend');
    return { title: 'GIF制作：多张图合成动图，本地生成免联网', path: '/pages/makeGif/makeGif' };
  },

  onShareTimeline() {
    analytics.trackShare('makeGif', 'timeline');
    return { title: '多图合成 GIF 动图，表情包神器' };
  }
});
