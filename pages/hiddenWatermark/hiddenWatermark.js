// pages/hiddenWatermark/hiddenWatermark.js
// 隐形水印：嵌入（文字 → 蓝通道 LSB）+ 提取（多数判决还原）。
// 算法见 utils/hidden-watermark.js（纯函数，已 node 单测）。
// 像素读写走 Canvas 2D，含 getImageData 兼容守卫（参照 colorAnalysis）。
const imageProcess = require('../../utils/image-process');
const hw = require('../../utils/hidden-watermark');
const analytics = require('../../utils/analytics');

const MAX_EDGE = 2048;      // 嵌入工作分辨率上限（控制 getImageData 内存 ≤16MB）
const DEFAULT_KEY = 'tuGeJianDan';

Page({
  data: {
    mode: 'embed',          // 'embed' | 'extract'
    key: DEFAULT_KEY,
    // 嵌入
    embedSrc: '',
    embedW: 0,
    embedH: 0,
    embedText: '',
    embedding: false,
    embedResult: '',
    embedOrigPath: '',
    embedDiff: '',
    showDiff: false,
    embedOrigSize: '',
    embedWmSize: '',
    embedBitsInfo: '',
    embedChangedInfo: '',
    // 提取
    extractSrc: '',
    extractW: 0,
    extractH: 0,
    extracting: false,
    extractText: '',
    extractConf: 0,
    extractStatus: '',      // '' | 'ok' | 'corrupt' | 'no-watermark'
    extractOk: false,
    extractNote: ''
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'hiddenWatermark' });
  },

  onUnload() {
    this._cancelled = true;
  },

  /* ---------------- 模式切换 ---------------- */

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.setData({ mode });
  },

  /* ---------------- 选图 ---------------- */

  async chooseImage() {
    try {
      const paths = await imageProcess.chooseImage(1, ['original', 'compressed'], ['album', 'camera']);
      if (!paths || !paths.length) return;
      const filePath = paths[0];
      if (this.data.mode === 'embed') {
        this.setData({
          embedSrc: filePath, embedW: 0, embedH: 0,
          embedResult: '', embedOrigPath: '', embedDiff: '',
          showDiff: false, embedOrigSize: '', embedWmSize: '', embedBitsInfo: '', embedChangedInfo: ''
        });
      } else {
        this.setData({
          extractSrc: filePath, extractW: 0, extractH: 0,
          extractText: '', extractConf: 0, extractStatus: '', extractOk: false, extractNote: ''
        });
      }
      // 读取尺寸展示
      try {
        const info = await imageProcess.getImageInfo(filePath);
        if (this.data.mode === 'embed') {
          this.setData({ embedW: info.width, embedH: info.height });
        } else {
          this.setData({ extractW: info.width, extractH: info.height });
        }
      } catch (e) { /* 忽略 */ }
    } catch (err) {
      if (err && err.errMsg && /cancel/i.test(err.errMsg)) return;
      console.error('选图失败', err);
      wx.showToast({ title: '选择失败', icon: 'none' });
    }
  },

  onTextInput(e) { this.setData({ embedText: e.detail.value }); },
  onKeyInput(e) { this.setData({ key: e.detail.value }); },

  /* ---------------- 嵌入 ---------------- */

  async doEmbed() {
    const { embedSrc: src, embedText: text, key } = this.data;
    if (!src) { wx.showToast({ title: '请先选择图片', icon: 'none' }); return; }
    if (!key) { wx.showToast({ title: '请输入密钥', icon: 'none' }); return; }
    // 空串允许（算法支持），但提示
    if (!text) {
      const ok = await new Promise((r) => wx.showModal({
        title: '水印文字为空', content: '嵌入空串仅写入同步头与校验，仍可提取验证链路。继续？',
        success: (m) => r(m.confirm)
      }));
      if (!ok) return;
    }

    this._cancelled = false;
    this.setData({ embedding: true, embedResult: '', embedOrigPath: '', embedDiff: '', showDiff: false });
    try {
      // 1. 取原图尺寸，计算降采样后的工作尺寸（保 alpha：用 drawImage 缩放，不走 compressImage）
      const info = await imageProcess.getImageInfo(src);
      const longest = Math.max(info.width, info.height);
      const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
      const W = Math.max(1, Math.round(info.width * scale));
      const H = Math.max(1, Math.round(info.height * scale));

      // 2. 画到 canvas 并取像素
      const canvas = await this._getCanvas();
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (typeof ctx.getImageData !== 'function') {
        throw new Error('当前微信版本不支持像素读取，请升级微信');
      }
      const img = await this._loadImage(canvas, info.path || src);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      img.src = '';
      await this._yield();
      const origImageData = ctx.getImageData(0, 0, W, H);
      const origRgba = origImageData.data;

      // 3. 嵌入（纯函数，操作副本）
      const emb = hw.embed(origRgba, W, H, text, key);
      if (!emb.ok) {
        throw new Error(emb.error || '嵌入失败');
      }

      // 4. 导出原图（降采样后，与水印图同尺寸，便于公平对比）
      const origPath = await this._exportCanvas(canvas, 'png');

      // 5. 写回水印图并导出（用 createImageData + data.set，避免依赖 ImageData 构造器）
      const wmImageData = ctx.createImageData(W, H);
      wmImageData.data.set(emb.rgba);
      ctx.putImageData(wmImageData, 0, 0);
      await this._yield();
      const wmPath = await this._exportCanvas(canvas, 'png');

      // 6. 改动位高亮图：压暗灰度原图作底，水印翻转蓝 LSB 的像素叠亮青点。
      //    线性 ×20 仍接近全黑（LSB ±1×20=20/255≈8% 亮度），改用二值高亮更直观。
      const diffRgba = new Uint8ClampedArray(origRgba.length);
      let changedPixels = 0;
      for (let i = 0; i < origRgba.length; i += 4) {
        const r = origRgba[i], g = origRgba[i + 1], b = origRgba[i + 2];
        const dim = ((r * 0.299 + g * 0.587 + b * 0.114) * 0.4) | 0; // 压暗灰度底
        if ((b & 1) !== (emb.rgba[i + 2] & 1)) {
          diffRgba[i] = 0; diffRgba[i + 1] = 240; diffRgba[i + 2] = 255; // 亮青 = 实际写入水印的像素
          changedPixels++;
        } else {
          diffRgba[i] = dim; diffRgba[i + 1] = dim; diffRgba[i + 2] = dim;
        }
        diffRgba[i + 3] = 255;
      }
      const totalPixels = W * H;
      const changedPct = totalPixels > 0 ? (changedPixels / totalPixels * 100).toFixed(2) : '0';
      const changedInfo = changedPixels + ' / ' + totalPixels + ' 像素（' + changedPct + '%）';
      const diffImageData = ctx.createImageData(W, H);
      diffImageData.data.set(diffRgba);
      ctx.putImageData(diffImageData, 0, 0);
      await this._yield();
      const diffPath = await this._exportCanvas(canvas, 'png');

      if (this._cancelled) return;

      // 7. 体积信息
      let origSizeText = '', wmSizeText = '';
      try {
        const [o, w] = await Promise.all([
          imageProcess.getFileSize(origPath),
          imageProcess.getFileSize(wmPath)
        ]);
        origSizeText = this._formatSize(o);
        wmSizeText = this._formatSize(w);
      } catch (e) { /* 忽略 */ }

      const payloadBytes = text ? hw.utf8Encode(text).length : 0;
      const bitsInfo = '嵌入 ' + emb.bitsUsed + ' 位（含 3× 冗余）· 文本 ' + payloadBytes + ' 字节';

      this.setData({
        embedResult: wmPath,
        embedOrigPath: origPath,
        embedDiff: diffPath,
        embedOrigSize: origSizeText,
        embedWmSize: wmSizeText,
        embedBitsInfo: bitsInfo,
        embedChangedInfo: changedInfo,
        embedW: W,
        embedH: H
      });
      analytics.track('tool_complete', { toolId: 'hiddenWatermark' });
      wx.showToast({ title: '嵌入完成', icon: 'success' });
    } catch (err) {
      console.error('嵌入失败', err);
      wx.showModal({
        title: '嵌入失败',
        content: (err && err.message) ? err.message : '未知错误，请重试',
        showCancel: false
      });
    } finally {
      this.setData({ embedding: false });
    }
  },

  toggleDiff() {
    this.setData({ showDiff: !this.data.showDiff });
  },

  async saveEmbedResult() {
    if (!this.data.embedResult) {
      wx.showToast({ title: '请先生成水印图', icon: 'none' });
      return;
    }
    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.embedResult);
    } catch (err) {
      console.error('保存失败', err);
      wx.showModal({ title: '保存失败', content: '可重试或检查相册权限', showCancel: false });
    }
  },

  /* ---------------- 提取 ---------------- */

  async doExtract() {
    const { extractSrc: src, key } = this.data;
    if (!src) { wx.showToast({ title: '请先选择图片', icon: 'none' }); return; }
    if (!key) { wx.showToast({ title: '请输入密钥', icon: 'none' }); return; }

    this._cancelled = false;
    this.setData({ extracting: true, extractText: '', extractConf: 0, extractStatus: '', extractOk: false, extractNote: '' });
    try {
      const info = await imageProcess.getImageInfo(src);
      // 提取必须读原始像素，不能缩放（缩放会破坏 LSB）。超大图给内存提示。
      const longest = Math.max(info.width, info.height);
      if (longest > 4096) {
        throw new Error('图片过大（' + longest + 'px），可能内存不足。建议使用嵌入时生成的图。');
      }
      const W = info.width;
      const H = info.height;

      const canvas = await this._getCanvas();
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (typeof ctx.getImageData !== 'function') {
        throw new Error('当前微信版本不支持像素读取，请升级微信');
      }
      const img = await this._loadImage(canvas, info.path || src);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      img.src = '';
      await this._yield();
      const imgData = ctx.getImageData(0, 0, W, H);

      if (this._cancelled) return;

      const ext = hw.extract(imgData.data, W, H, key);
      let note = '';
      if (ext.status === 'ok') {
        note = 'CRC 校验通过，文字完整还原';
      } else if (ext.status === 'corrupt') {
        note = '已定位水印但 CRC 校验失败：数据可能受损（压缩/重编码/截图），下方为最佳还原结果';
      } else {
        note = '未检出有效水印：图片可能未嵌入水印，或密钥不匹配';
      }
      this.setData({
        extractText: ext.text,
        extractConf: ext.confidence,
        extractStatus: ext.status,
        extractOk: ext.ok,
        extractNote: note,
        extractW: W,
        extractH: H
      });
      analytics.track('tool_complete', { toolId: 'hiddenWatermark' });
    } catch (err) {
      console.error('提取失败', err);
      wx.showModal({
        title: '提取失败',
        content: (err && err.message) ? err.message : '未知错误，请重试',
        showCancel: false
      });
    } finally {
      this.setData({ extracting: false });
    }
  },

  copyExtractText() {
    if (!this.data.extractText) return;
    wx.setClipboardData({
      data: this.data.extractText,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    });
  },

  /* ---------------- 预览 ---------------- */

  preview(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({ current: url, urls: [url] });
  },

  /* ---------------- 清空 ---------------- */

  clearEmbed() {
    this.setData({
      embedSrc: '', embedW: 0, embedH: 0, embedText: '',
      embedResult: '', embedOrigPath: '', embedDiff: '',
      showDiff: false, embedOrigSize: '', embedWmSize: '', embedBitsInfo: ''
    });
  },

  clearExtract() {
    this.setData({
      extractSrc: '', extractW: 0, extractH: 0,
      extractText: '', extractConf: 0, extractStatus: '', extractOk: false, extractNote: ''
    });
  },

  /* ---------------- 工具 ---------------- */

  _getCanvas() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#workCanvas')
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

  _exportCanvas(canvas, fileType) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: fileType,
        quality: 1,
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      });
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
    analytics.trackShare('hiddenWatermark', 'friend');
    return { title: '隐形水印：文字藏进图片像素，可密钥提取还原', path: '/pages/hiddenWatermark/hiddenWatermark' };
  },

  onShareTimeline() {
    analytics.trackShare('hiddenWatermark', 'timeline');
    return { title: '给图片加隐形水印防盗图，可提取验证' };
  }
});
