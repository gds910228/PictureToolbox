// pkgGif/pages/gifBatch/gifBatch.js
// GIF 批量处理：多选 GIF → 逐个解码 → 应用操作（调速/倒放/压缩/裁剪）→ 批量导出。
// 串行处理防内存峰值，复用 gif-decoder/gif-encoder/gif-compress 引擎。
const imageProcess = require('../../../utils/image-process');
const { decodeGifChunked } = require('../../utils/gif-decoder');
const { buildGIFDiff } = require('../../utils/gif-encoder');
const { compressGif } = require('../../utils/gif-compress');
const { cropFrame } = require('../../utils/gif-frame-ops');
const analytics = require('../../../utils/analytics');

const MAX_FILES = 9;
const MAX_DIMENSION = 480;
const MAX_FRAMES = 60;   // 防 9 文件 × 多帧全画布 rgba 撑爆堆内存

// 统一裁剪比例
const CROP_RATIOS = [
  { value: 0, label: '不裁剪' },
  { value: 1, label: '1:1', w: 1, h: 1 },
  { value: 4 / 3, label: '4:3', w: 4, h: 3 },
  { value: 16 / 9, label: '16:9', w: 16, h: 9 },
  { value: 9 / 16, label: '9:16', w: 9, h: 16 }
];

const SPEED_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x' }
];

Page({
  data: {
    files: [],          // [{id, name, size, sizeText, path, status, frameCount, width, height, error}]（帧像素存实例字段 _framesById，绝不进 data——setData 会深拷贝序列化）
    // status: 'pending' | 'decoding' | 'ready' | 'processing' | 'done' | 'failed'
    processing: false,
    overallProgress: 0,
    overallText: '',
    // 全局操作
    speedIndex: 1,
    speedOptions: SPEED_OPTIONS,
    cropIndex: 0,
    cropRatios: CROP_RATIOS,
    reverseAll: false,
    compressEnabled: false,
    targetSize: 1.0,
    sizeUnit: 'MB',      // 'KB' | 'MB' 目标体积单位
    maxFiles: MAX_FILES,
    // 统计
    totalDone: 0,
    totalFailed: 0
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'gifBatch' });
  },

  chooseGif() {
    if (this.data.files.length >= MAX_FILES) {
      wx.showToast({ title: `最多 ${MAX_FILES} 个文件`, icon: 'none' });
      return;
    }
    const remain = MAX_FILES - this.data.files.length;
    wx.chooseMessageFile({
      count: remain,
      type: 'file',
      extension: ['gif'],
      success: (res) => {
        for (const f of res.tempFiles) {
          this._addFile(f);
        }
      },
      fail: (err) => {
        if (err && err.errMsg && /cancel/i.test(err.errMsg)) return;
        wx.showToast({ title: '选择失败', icon: 'none' });
      }
    });
  },

  // 相册辅助入口：微信通常会把相册 GIF 转码为静态 JPG（取第一帧），
  // 仅当环境直出 .gif 原文件时可用；GIF8 头部校验兜底，坏文件在解码前即标失败。
  chooseFromAlbum() {
    if (this.data.files.length >= MAX_FILES) {
      wx.showToast({ title: `最多 ${MAX_FILES} 个文件`, icon: 'none' });
      return;
    }
    const remain = MAX_FILES - this.data.files.length;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
      success: (res) => {
        for (const f of (res.tempFiles || [])) {
          this._addFile({ name: '相册图片', path: f.tempFilePath, size: f.size, fromAlbum: true });
        }
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
      content: '1. 把 .gif 文件发到聊天（推荐「文件传输助手」）：点 + → 文件 → 选择 .gif，发送后显示为文件卡片\n2. 回到本页点「+ 从聊天导入 GIF」，选中该聊天即可（可多选）\n\n注意：\n· 以图片/表情方式发送的 GIF 不是文件，选不到\n· iOS 相册里的 GIF 需先「存储到文件」再发送',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  _addFile(file) {
    const id = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const item = {
      id,
      name: file.name || 'unknown.gif',
      size: file.size,
      sizeText: this._formatSize(file.size),
      path: file.path,
      fromAlbum: !!file.fromAlbum,
      status: 'decoding',
      frameCount: 0,
      width: 0,
      height: 0,
      error: ''
    };
    const files = this.data.files.concat(item);
    this.setData({ files });
    // 串行解码队列：卡片立即出现，解码逐个排队执行，避免连续占满 JS 线程
    this._decodeQueue = (this._decodeQueue || Promise.resolve())
      .then(() => this._decodeFile(item))
      .catch(() => {});
  },

  async _decodeFile(item) {
    try {
      const fs = wx.getFileSystemManager();
      const buffer = await new Promise((resolve, reject) => {
        fs.readFile({ filePath: item.path, success: r => resolve(r.data), fail: reject });
      });

      const head = new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength));
      const sig = String.fromCharCode(head[0], head[1], head[2], head[3], head[4], head[5]);
      if (sig !== 'GIF87a' && sig !== 'GIF89a') {
        this._updateFile(item.id, {
          status: 'failed',
          error: item.fromAlbum
            ? '非 GIF：相册图被微信转成静态 JPG，请从聊天导入'
            : '非 GIF 文件'
        });
        return;
      }

      // 分块解码：同步 decodeGif 会长时间阻塞 JS 线程（多文件时尤甚）
      const decoded = await decodeGifChunked(buffer, { batchSize: 8 });
      if (Math.max(decoded.width, decoded.height) > MAX_DIMENSION) {
        this._updateFile(item.id, {
          status: 'failed',
          error: `尺寸 ${decoded.width}×${decoded.height} 超限`
        });
        return;
      }
      if (decoded.frames.length > MAX_FRAMES) {
        this._updateFile(item.id, {
          status: 'failed',
          error: `帧数 ${decoded.frames.length} 超限（≤${MAX_FRAMES}）`
        });
        return;
      }

      // 帧像素只进实例字段：setData 会深拷贝序列化，rgba 数组进 data
      // 会让每次状态更新都序列化几十~几百 MB（配置点击卡顿数秒的根因）
      if (!this._framesById) this._framesById = {};
      this._framesById[item.id] = decoded.frames.map(f => ({
        rgba: f.rgba,
        delayMs: f.delayMs
      }));

      this._updateFile(item.id, {
        status: 'ready',
        frameCount: decoded.frames.length,
        width: decoded.width,
        height: decoded.height
      });
    } catch (e) {
      console.error('解码失败', e);
      this._updateFile(item.id, { status: 'failed', error: e.message || '解码失败' });
    }
  },

  _updateFile(id, updates) {
    const files = this.data.files.map(f => f.id === id ? { ...f, ...updates } : f);
    this.setData({ files });
  },

  removeFile(e) {
    const id = e.currentTarget.dataset.id;
    // 同步释放帧像素内存
    if (this._framesById) delete this._framesById[id];
    const files = this.data.files.filter(f => f.id !== id);
    this.setData({ files });
  },

  retryFile(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.files.find(f => f.id === id);
    if (!item) return;
    this._updateFile(id, { status: 'decoding', error: '' });
    this._decodeFile({ ...item, path: item.path });
  },

  // 全局设置
  setSpeed(e) {
    this.setData({ speedIndex: Number(e.currentTarget.dataset.index) });
  },
  setCrop(e) {
    this.setData({ cropIndex: Number(e.currentTarget.dataset.index) });
  },
  toggleReverse() {
    this.setData({ reverseAll: !this.data.reverseAll });
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

  // 批量处理
  async processAll() {
    const ready = this.data.files.filter(f => f.status === 'ready');
    if (ready.length === 0) {
      wx.showToast({ title: '没有可处理的文件', icon: 'none' });
      return;
    }
    // 开了压缩但目标体积无效（空/0/NaN）——不静默降级，明示用户
    if (this.data.compressEnabled && !(Number(this.data.targetSize) > 0)) {
      wx.showToast({ title: '目标体积无效，将按原画质导出', icon: 'none' });
    }

    this.setData({ processing: true, totalDone: 0, totalFailed: 0 });
    let done = 0, failed = 0;

    for (let i = 0; i < ready.length; i++) {
      const item = ready[i];
      this._updateFile(item.id, { status: 'processing' });
      this.setData({
        overallProgress: Math.round((i / ready.length) * 100),
        overallText: `处理 ${i + 1}/${ready.length}: ${item.name}`
      });

      try {
        const result = await this._processOne(item);
        this._updateFile(item.id, {
          status: 'done',
          outputPath: result.path,
          outputSize: result.size,
          outputSizeText: this._formatSize(result.size)
        });
        done++;
      } catch (e) {
        console.error('处理失败', item.name, e);
        this._updateFile(item.id, { status: 'failed', error: e.message || '处理失败' });
        failed++;
      }
      this.setData({ totalDone: done, totalFailed: failed });
      await new Promise(r => setTimeout(r, 50));
    }

    this.setData({
      processing: false,
      overallProgress: 100,
      overallText: `完成 ${done} 成功 / ${failed} 失败`
    });
    wx.showToast({ title: `完成：${done} 成功`, icon: 'success' });
    analytics.track('gif_batch_complete', { done, failed, count: ready.length });
  },

  async _processOne(item) {
    // 浅拷贝帧列表：crop/speed 改的是副本，_framesById 原件保持干净供重试用
    let frames = ((this._framesById || {})[item.id] || []).map(f => ({ rgba: f.rgba, delayMs: f.delayMs }));
    if (frames.length === 0) throw new Error('帧数据丢失，请移除后重新添加');
    let W = item.width, H = item.height;

    // 1. 裁剪
    const cropRatio = CROP_RATIOS[this.data.cropIndex];
    if (cropRatio.w > 0) {
      let cw, ch;
      if (W / H > cropRatio.w / cropRatio.h) {
        ch = H; cw = Math.round(H * cropRatio.w / cropRatio.h);
      } else {
        cw = W; ch = Math.round(W * cropRatio.h / cropRatio.w);
      }
      const cx = Math.round((W - cw) / 2);
      const cy = Math.round((H - ch) / 2);
      for (const f of frames) {
        f.rgba = cropFrame(f.rgba, W, H, cx, cy, cw, ch);
      }
      W = cw; H = ch;
    }

    // 2. 倒放
    if (this.data.reverseAll) frames.reverse();

    // 3. 调速
    const speed = SPEED_OPTIONS[this.data.speedIndex].value;
    for (const f of frames) f.delayMs = Math.max(20, Math.round(f.delayMs / speed));

    // 4. 编码
    const encFrames = frames.map(f => ({
      width: W, height: H, rgba: f.rgba,
      delayCs: Math.max(2, Math.round(f.delayMs / 10))
    }));

    let gifBytes;
    if (this.data.compressEnabled && this.data.targetSize > 0) {
      const targetBytes = Math.round(this.data.sizeUnit === 'KB'
        ? this.data.targetSize * 1024
        : this.data.targetSize * 1024 * 1024);
      const result = compressGif(
        frames.map(f => ({ rgba: f.rgba, delayMs: f.delayMs, width: W, height: H })),
        W, H, targetBytes, { loop: 0 }
      );
      gifBytes = result.bytes;
    } else {
      gifBytes = buildGIFDiff(encFrames, { width: W, height: H, loop: 0, dither: false });
    }

    // 5. 写入文件
    const fs = wx.getFileSystemManager();
    const baseName = item.name.replace(/\.gif$/i, '');
    const outPath = `${wx.env.USER_DATA_PATH}/batch_${baseName}_${Date.now()}.gif`;
    await new Promise((resolve, reject) => {
      fs.writeFile({
        filePath: outPath,
        data: gifBytes.buffer,
        encoding: 'binary',
        success: resolve,
        fail: reject
      });
    });

    return { path: outPath, size: gifBytes.length };
  },

  // 保存单个结果
  async saveOne(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.files.find(f => f.id === id);
    if (!item || !item.outputPath) return;
    try {
      await imageProcess.saveImageToPhotosAlbum(item.outputPath);
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      wx.showModal({
        title: '保存失败',
        content: '请检查相册权限',
        showCancel: false
      });
    }
  },

  // 保存全部
  async saveAll() {
    const done = this.data.files.filter(f => f.status === 'done' && f.outputPath);
    if (done.length === 0) return;
    let saved = 0;
    for (const f of done) {
      try {
        await imageProcess.saveImageToPhotosAlbum(f.outputPath);
        saved++;
      } catch (e) { /* skip */ }
    }
    wx.showToast({ title: `已保存 ${saved} 个`, icon: 'success' });
  },

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  },

  onShareAppMessage() {
    analytics.trackShare('gifBatch', 'friend');
    return { title: 'GIF批量处理：调速/倒放/压缩/裁剪，本地免联网', path: '/pkgGif/pages/gifBatch/gifBatch' };
  }
});
