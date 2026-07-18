// pages/idPhoto/idPhoto.js
// 证件照制作：选图 → 云端 AI 抠图 + 人脸定位（并行）→ roll 校正 + 居中 → 多规格多底色端上 canvas 合成。
// 人脸定位走云端腾讯 IAI DetectFace（曾验证 wx.VKSession.detectFace 静态图检测不可用，故改走云端）。
// 几何变换纯函数见 utils/id-photo-geometry.js。
//
// 复用既有约定：
//   - 选图/取信息/存相册：utils/image-process
//   - 前端内容安全：utils/content-check.guardImage
//   - 抠图：云函数 aiMatting（返回抠图 PNG 的 cloud fileID，保持原图尺寸）
//   - 人脸：云函数 detectFace（返回 face 框 + roll/pitch/yaw，吃同一张原图 fileID）
// 两个云函数吃同一 fileID → Promise.all 并行，省一次往返。

const imageProcess = require('../../utils/image-process');
const { guardImage } = require('../../utils/content-check');
const { computeCompositeTransform, computeCenterCrop } = require('../../utils/id-photo-geometry');
const analytics = require('../../utils/analytics');

// 证件照规格（@300dpi 近似像素）。标准中国证件照尺寸。
const SPECS = [
  { key: '1inch',  label: '一寸',   w: 295, h: 413 },
  { key: 'small1', label: '小一寸', w: 260, h: 378 },
  { key: 'big1',   label: '大一寸', w: 390, h: 567 },
  { key: '2inch',  label: '二寸',   w: 413, h: 579 },
  { key: 'small2', label: '小二寸', w: 413, h: 531 },
  { key: 'big2',   label: '大二寸', w: 413, h: 626 }
];

// 标准底色
const BGS = [
  { key: 'white', label: '白底', color: '#FFFFFF' },
  { key: 'blue',  label: '蓝底', color: '#438EDB' },
  { key: 'red',   label: '红底', color: '#D9001B' }
];

const ROLL_SKIP_DEG = 2;  // roll 绝对值小于此度数则跳过旋转，避免无谓重采样模糊

Page({
  data: {
    specs: SPECS,
    bgs: BGS,
    spec: SPECS[0],
    bg: BGS[0],
    status: '',
    statusType: '',      // '' | 'ok' | 'warn'
    logs: [],
    hasResult: false,
    resultPath: '',
    processing: false
  },

  // 实例级缓存：换规格/换底色时复用，免重走云端
  // this._cutoutPath  本地抠图路径（canvas.createImage 需本地路径）
  // this._face        {x,y,width,height} | null
  // this._roll        number（度）
  // this._cutoutW/H   抠图尺寸
  // this._composeChain 合成串行链，避免快速切换规格时 canvas 绘制交错

  onLoad() {
    analytics.track('tool_view', { toolId: 'idPhoto' });
    this._composeChain = Promise.resolve();
  },

  _log(msg) {
    const t = new Date();
    const ts = ('0' + t.getHours()).slice(-2) + ':' +
               ('0' + t.getMinutes()).slice(-2) + ':' +
               ('0' + t.getSeconds()).slice(-2);
    console.log('[idPhoto]', msg);
    this.setData({ logs: this.data.logs.concat(['[' + ts + '] ' + msg]) });
  },

  _setStatus(status, statusType) { this.setData({ status, statusType }); },

  onSpec(e) {
    const key = e.currentTarget.dataset.key;
    const spec = SPECS.find(s => s.key === key) || this.data.spec;
    this.setData({ spec, hasResult: false, resultPath: '', status: '', statusType: '' });
    if (this._cutoutPath) this._compose();   // 本地重合成，秒级
  },

  onBg(e) {
    const key = e.currentTarget.dataset.key;
    const bg = BGS.find(b => b.key === key) || this.data.bg;
    this.setData({ bg, hasResult: false, resultPath: '', status: '', statusType: '' });
    if (this._cutoutPath) this._compose();
  },

  async onPick() {
    if (this.data.processing) return;
    // 新图 → 清缓存
    this._cutoutPath = null; this._face = null; this._roll = 0; this._cutoutW = 0; this._cutoutH = 0;
    this.setData({ logs: [], hasResult: false, resultPath: '', status: '', statusType: '' });

    // 选图
    let paths;
    try {
      paths = await imageProcess.chooseImage(1, ['original', 'compressed'], ['album', 'camera']);
    } catch (e) {
      if (e && e.errMsg && /cancel/i.test(e.errMsg)) return;
      console.error('选图失败', e);
      this._setStatus('选图失败', 'warn');
      return;
    }
    if (!paths || !paths.length) return;
    const localPath = paths[0];

    // 内容安全
    if (!(await guardImage(localPath))) return;

    this.setData({ processing: true });
    this._log('开始处理');

    try {
      // 1) 上传前压缩：DetectFace/抠图 base64 上限 5MB，手机原图易超 → 限定最长边，规避 ImageSizeExceed
      this._setStatus('处理图片…', '');
      const uploadPath = await this._compressForUpload(localPath);
      this._setStatus('上传中…', '');
      const fileID = await this._uploadCloud(uploadPath);
      if (!fileID) throw new Error('上传失败');
      this._log('上传完成');

      // 2) 并行：抠图 + 人脸定位（同 fileID）
      this._setStatus('AI 抠图 + 人脸定位中…', '');
      const [matRes, faceRes] = await Promise.all([
        this._callFn('aiMatting', { fileID }),
        this._callFn('detectFace', { fileID })
      ]);

      // 3) 抠图结果 → 本地路径
      if (!matRes || !matRes.success || !matRes.fileID || matRes.fileID === 'original') {
        // aiMatting 回退到「仅识别」时 fileID 为 'original'，无真实抠图 → 无法换底
        throw new Error('AI 抠图未成功，请换一张正面清晰的人像照片重试');
      }
      this._cutoutPath = await this._downloadCloudFile(matRes.fileID);
      const info = await imageProcess.getImageInfo(this._cutoutPath);
      this._cutoutW = info.width;
      this._cutoutH = info.height;
      this._log('抠图完成 ' + info.width + '×' + info.height);

      // 4) 人脸结果
      if (faceRes && faceRes.success && !faceRes.noFace && faceRes.face) {
        this._face = faceRes.face;
        this._roll = faceRes.roll || 0;
        this._log('检出人脸 roll=' + this._roll.toFixed(1) + '° 框=' +
          this._face.x + ',' + this._face.y + ' ' + this._face.width + '×' + this._face.height);
      } else if (faceRes && faceRes.success && faceRes.noFace) {
        this._face = null; this._roll = 0;
        this._log('⚠ 未检出人脸，将居中裁剪兜底');
      } else {
        // detectFace 调用失败（服务未开通/超限/限流等）→ 居中裁剪兜底，但如实记录原因
        this._face = null; this._roll = 0;
        const reason = (faceRes && (faceRes.error || faceRes.code)) || '未知';
        this._log('⚠ 人脸定位失败(' + reason + ')，将居中裁剪兜底');
      }

      // 5) 合成
      await this._compose();
    } catch (err) {
      console.error('[idPhoto] 失败', err);
      const msg = (err && (err.message || err.errMsg)) || '未知错误';
      this._log('❌ ' + msg);
      this._setStatus('处理失败：' + msg, 'warn');
      wx.showModal({ title: '处理失败', content: msg, showCancel: false, confirmText: '我知道了' });
    } finally {
      this.setData({ processing: false });
    }
  },

  // 合成入口：串行排队，避免快速切换规格时 canvas 绘制交错
  _compose() {
    if (!this._composeChain) this._composeChain = Promise.resolve();
    this._composeChain = this._composeChain.then(() => this._doCompose());
    return this._composeChain;
  },

  // 实际合成：底色 + 抠图变换 → canvas → temp 文件
  async _doCompose() {
    if (!this._cutoutPath) return;
    const { spec, bg } = this.data;
    this._setStatus('合成 ' + spec.label + ' ' + spec.w + '×' + spec.h + ' ' + bg.label + '…', '');
    try {
      const canvas = await this._getCanvas();
      canvas.width = spec.w;
      canvas.height = spec.h;
      const ctx = canvas.getContext('2d');

      // 底色（不透明纯色，JPG 无 alpha 问题）
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, spec.w, spec.h);

      // 抠图
      const img = await this._loadImage(canvas, this._cutoutPath);

      if (this._face) {
        // 人脸定位 + roll 校正 + 居中
        const t = computeCompositeTransform(this._face, this._roll, this._cutoutW, this._cutoutH, spec.w, spec.h);
        ctx.save();
        ctx.translate(t.targetCx, t.targetCy);
        if (Math.abs(this._roll) >= ROLL_SKIP_DEG) {
          ctx.rotate(t.rotateDeg * Math.PI / 180);
        }
        ctx.scale(t.scale, t.scale);
        ctx.drawImage(img, -t.faceCx, -t.faceCy, t.srcW, t.srcH);
        ctx.restore();
        this._log('合成完成（人脸定位' + (Math.abs(this._roll) >= ROLL_SKIP_DEG ? ' + roll 校正' : '') + '）');
      } else {
        // 无人脸兜底：按规格宽高比居中裁剪
        const c = computeCenterCrop(this._cutoutW, this._cutoutH, spec.w, spec.h);
        ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, spec.w, spec.h);
        this._log('合成完成（居中裁剪兜底）');
      }

      // 导出 temp 文件
      const tempPath = await this._exportCanvas(canvas, spec.w, spec.h);
      this.setData({ hasResult: true, resultPath: tempPath });
      analytics.track('tool_complete', { toolId: 'idPhoto' });
      this._setStatus('完成：可换规格/底色快速重览，或保存到相册', 'ok');
    } catch (err) {
      console.error('[idPhoto] 合成失败', err);
      const msg = (err && (err.message || err.errMsg)) || '';
      this._log('❌ 合成失败: ' + msg);
      this._setStatus('合成失败：' + (msg || '请重试'), 'warn');
    }
  },

  // 上传前压缩：DetectFace/抠图 base64 上限 5MB，手机原图易超 → 限定最长边，规避 ImageSizeExceed
  // compressImage 强制输出 JPG（丢 alpha），但输入是带背景的人像照片，无需 alpha，无影响。
  async _compressForUpload(filePath) {
    const MAX_EDGE = 1500;
    try {
      const info = await imageProcess.getImageInfo(filePath);
      const longest = Math.max(info.width, info.height);
      if (longest <= MAX_EDGE) return filePath;
      const opt = info.width >= info.height
        ? { compressedWidth: MAX_EDGE }
        : { compressedHeight: MAX_EDGE };
      return await new Promise((resolve, reject) => {
        wx.compressImage(Object.assign({ src: filePath, quality: 85 }, opt, {
          success: (r) => resolve(r.tempFilePath),
          fail: reject
        }));
      });
    } catch (e) {
      console.warn('[idPhoto] 压缩失败，回退原图', e);
      return filePath;
    }
  },

  _uploadCloud(filePath) {
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath: `idPhoto/${Date.now()}.jpg`,
        filePath,
        success: (res) => resolve(res.fileID),
        fail: (err) => reject(err)
      });
    });
  },

  // 云函数调用：失败时返回结构化失败（不抛），让上层按字段判断
  _callFn(name, data) {
    return wx.cloud.callFunction({ name, data })
      .then((res) => res && res.result)
      .catch((err) => {
        console.error('[idPhoto] callFunction ' + name + ' 失败', err);
        return { success: false, error: (err && (err.errMsg || err.message)) || '云函数调用失败' };
      });
  },

  // cloud fileID → 本地 temp 路径（canvas.createImage 需本地路径，规避 CDN/CORS）
  async _downloadCloudFile(fileID) {
    const urlRes = await new Promise((resolve, reject) => {
      wx.cloud.getTempFileURL({ fileList: [fileID], success: resolve, fail: reject });
    });
    const item = urlRes.fileList && urlRes.fileList[0];
    if (!item || item.status !== 0 || !item.tempFileURL) {
      throw new Error('获取抠图地址失败');
    }
    const dl = await new Promise((resolve, reject) => {
      wx.downloadFile({ url: item.tempFileURL, success: resolve, fail: reject });
    });
    if (!dl.tempFilePath) throw new Error('下载抠图失败');
    return dl.tempFilePath;
  },

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

  _exportCanvas(canvas, w, h) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        x: 0, y: 0,
        width: w, height: h,
        destWidth: w, destHeight: h,
        fileType: 'jpg',
        quality: 1,
        success: (res) => resolve(res.tempFilePath),
        fail: (err) => reject(err)
      });
    });
  },

  async onSave() {
    if (!this.data.resultPath) {
      wx.showToast({ title: '请先生成', icon: 'none' });
      return;
    }
    try {
      await imageProcess.saveImageToPhotosAlbum(this.data.resultPath);
      this._log('已保存到相册');
    } catch (err) {
      console.error('保存失败', err);
      if (err && err.errMsg && /auth/i.test(err.errMsg)) {
        wx.showModal({ title: '提示', content: '需要您授权保存图片到相册', showCancel: false });
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    }
  },

  previewResult() {
    if (!this.data.resultPath) return;
    wx.previewImage({ current: this.data.resultPath, urls: [this.data.resultPath] });
  },

  onShareAppMessage() {
    analytics.trackShare('idPhoto', 'friend');
    return { title: '证件照制作：AI 抠图换底色，一寸二寸多规格', path: '/pages/idPhoto/idPhoto', imageUrl: this.data.resultPath || '' };
  },

  onShareTimeline() {
    analytics.trackShare('idPhoto', 'timeline');
    return { title: '免费做证件照：AI 抠图换底色，一键多规格' };
  }
});
