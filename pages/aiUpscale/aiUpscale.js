// pages/aiUpscale/aiUpscale.js
// AI 图片放大增强 —— 上传 → 选倍数/增强 → 提交任务 → 轮询结果 → 对比/保存
// 云端不可用时降级为本地基础放大（Canvas 平滑缩放）。

const compareHelper = require('../../utils/compare-helper');
const { ensureBounded, enhanceImage, localUpscale } = require('../../utils/upscale-local');

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 入口文件大小上限 20MB
const POLL_INTERVAL = 3000;             // 轮询间隔 3s
const POLL_MAX = 40;                    // 最多轮询 40 次（约 2 分钟）

Page({
  data: {
    // 图片
    imageSrc: '',        // 原图（用于展示与对比）
    fileID: '',          // 已上传工作图 fileID（缩放/增强后）
    resultSrc: '',       // 结果图（cloud:// / 本地路径）
    resultFileID: '',

    // 选项
    scale: 2,
    denoise: false,
    sharpen: false,

    // 状态
    processing: false,
    progress: 0,
    statusText: '',
    errorMsg: '',

    // 结果信息
    degraded: false,
    degradeReason: '',
    engine: '',
    engineText: ''
  },

  onLoad() {
    this._pollTimer = null;
    this._pollCount = 0;
    this._workPath = ''; // 缩放/增强后的工作图本地路径
  },

  onUnload() {
    this._stopPolling();
  },

  onHide() {
    this._stopPolling();
  },

  // ============================================================
  // 步骤 1：选择图片
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
        that.setData({
          imageSrc: file.tempFilePath,
          fileID: '',
          resultSrc: '',
          resultFileID: '',
          degraded: false,
          errorMsg: ''
        });
        that.prepareAndUpload(file.tempFilePath);
      }
    });
  },

  async prepareAndUpload(filePath) {
    const that = this;
    wx.showLoading({ title: '处理图片中...', mask: true });

    // 1) 最长边限制到 1440（满足 Real-ESRGAN 建议输入，控制输出尺寸/内存）
    let workPath = filePath;
    try {
      const bounded = await ensureBounded(filePath, 1440);
      workPath = bounded.path;
    } catch (e) {
      console.warn('[aiUpscale] ensureBounded 失败，使用原图', e);
    }

    // 2) 内容安全检测（违规内部已弹标准提示，不暴露原因）
    try {
      const { guardImage } = require('../../utils/content-check');
      if (!(await guardImage(workPath))) {
        this.setData({ imageSrc: '', fileID: '' });
        wx.hideLoading();
        return;
      }
    } catch (e) {
      console.warn('[aiUpscale] 内容安全检测异常，继续', e);
    }

    this._workPath = workPath;
    wx.hideLoading();
    wx.showLoading({ title: '上传中...', mask: true });

    const cloudPath = `aiUpscale/${Date.now()}.jpg`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath: workPath,
      success: (res) => {
        that.setData({ fileID: res.fileID });
        wx.hideLoading();
      },
      fail: (err) => {
        console.error('[aiUpscale] 上传失败', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  // ============================================================
  // 选项
  // ============================================================
  selectScale(e) {
    this.setData({ scale: Number(e.currentTarget.dataset.scale), resultSrc: '', resultFileID: '', errorMsg: '' });
  },

  toggleDenoise() {
    this.setData({ denoise: !this.data.denoise });
  },

  toggleSharpen() {
    this.setData({ sharpen: !this.data.sharpen });
  },

  // ============================================================
  // 步骤 2：开始放大
  // ============================================================
  async startUpscale() {
    if (this.data.processing) return;
    if (!this.data.imageSrc) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }

    this._pollCount = 0;
    this.setData({
      processing: true,
      progress: 5,
      statusText: '正在准备图片...',
      errorMsg: '',
      resultSrc: '',
      resultFileID: '',
      degraded: false,
      degradeReason: '',
      engine: '',
      engineText: ''
    });

    try {
      // 1) 基础增强（降噪/锐化，作用于放大前的工作图）
      let workPath = this._workPath || this.data.imageSrc;
      if (this.data.denoise || this.data.sharpen) {
        try {
          this.setData({ statusText: '正在应用基础增强...' });
          workPath = await enhanceImage(workPath, { denoise: this.data.denoise, sharpen: this.data.sharpen });
          // 重新上传增强后的工作图
          this.setData({ statusText: '正在上传增强图...', progress: 12 });
          const up = await this._uploadAsync(workPath);
          this._workPath = workPath;
          this.setData({ fileID: up.fileID });
        } catch (e) {
          console.warn('[aiUpscale] 增强失败，使用未增强图', e);
        }
      }

      // 2) 提交 AI 任务
      if (!this.data.fileID) {
        // 上传失败兜底：直接本地放大
        await this._runLocalUpscale(workPath, '图片未上传成功，使用本地基础放大');
        return;
      }

      this.setData({ statusText: '正在提交 AI 任务...', progress: 20 });
      let submitRes;
      try {
        submitRes = await wx.cloud.callFunction({
          name: 'aiUpscale',
          data: { action: 'submit', fileID: this.data.fileID, scale: this.data.scale }
        });
      } catch (e) {
        console.warn('[aiUpscale] 提交云函数失败，走本地', e);
        await this._runLocalUpscale(workPath, '网络连接异常，已切换到本地基础放大');
        return;
      }

      const r = (submitRes && submitRes.result) || {};

      // 3) 云端不可用 / 提交失败 → 本地降级
      if (r.mode === 'local' || !r.success) {
        await this._runLocalUpscale(workPath, r.reason || 'AI 服务暂不可用，已切换到本地基础放大');
        return;
      }

      // 4) AI 模式：轮询
      this._startPolling(r.taskId, workPath);
    } catch (err) {
      console.error('[aiUpscale] 放大异常:', err);
      this.setData({ processing: false, progress: 0 });
      wx.showToast({ title: '处理失败', icon: 'none' });
    }
  },

  _uploadAsync(filePath) {
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath: `aiUpscale/${Date.now()}.jpg`,
        filePath,
        success: (res) => resolve(res),
        fail: reject
      });
    });
  },

  // ============================================================
  // 轮询 AI 任务
  // ============================================================
  _startPolling(taskId, workPath) {
    const that = this;
    this.setData({ statusText: 'AI 放大中，请稍候...' });

    const tick = async () => {
      that._pollCount += 1;
      if (that._pollCount > POLL_MAX) {
        that._stopPolling();
        await that._runLocalUpscale(workPath, 'AI 处理超时，已切换到本地基础放大');
        return;
      }

      // 进度模拟：每次 +5，封顶 90
      that.setData({
        progress: Math.min(90, 25 + that._pollCount * 5),
        statusText: `AI 放大中...（第 ${that._pollCount} 次）`
      });

      let res;
      try {
        res = await wx.cloud.callFunction({
          name: 'aiUpscale',
          data: { action: 'query', taskId }
        });
      } catch (e) {
        console.warn('[aiUpscale] 查询失败，稍后重试', e);
        that._pollTimer = setTimeout(tick, POLL_INTERVAL);
        return;
      }

      const r = (res && res.result) || {};
      if (r.status === 'succeeded' && r.fileID) {
        that._stopPolling();
        that.setData({
          resultSrc: r.fileID,
          resultFileID: r.fileID,
          progress: 100,
          processing: false,
          engine: r.engine || 'replicate-real-esrgan',
          engineText: 'AI 超分'
        });
        return;
      }

      if (r.status === 'failed' || r.mode === 'local') {
        that._stopPolling();
        await that._runLocalUpscale(workPath, r.reason || 'AI 处理失败，已切换到本地基础放大');
        return;
      }

      // processing —— 继续轮询
      that._pollTimer = setTimeout(tick, POLL_INTERVAL);
    };

    this._pollTimer = setTimeout(tick, POLL_INTERVAL);
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  // ============================================================
  // 本地基础放大降级
  // ============================================================
  async _runLocalUpscale(workPath, reason) {
    this.setData({
      statusText: '本地基础放大中...',
      progress: 60,
      degraded: true,
      degradeReason: reason || '当前为基础放大，效果弱于 AI 放大',
      engine: 'local-bilinear',
      engineText: '基础放大'
    });
    try {
      const out = await localUpscale(workPath, this.data.scale);
      this.setData({
        resultSrc: out,
        resultFileID: '',
        progress: 100,
        processing: false
      });
    } catch (e) {
      console.error('[aiUpscale] 本地放大失败', e);
      this.setData({ processing: false, progress: 0 });
      wx.showToast({ title: '本地放大失败', icon: 'none' });
    }
  },

  // ============================================================
  // 结果操作
  // ============================================================
  previewOriginal() {
    if (!this.data.imageSrc) return;
    wx.previewImage({ current: this.data.imageSrc, urls: [this.data.imageSrc] });
  },

  previewResult() {
    if (!this.data.resultSrc) return;
    wx.previewImage({ current: this.data.resultSrc, urls: [this.data.resultSrc] });
  },

  onCompare() {
    if (!this.data.imageSrc || !this.data.resultSrc) {
      wx.showToast({ title: '请先完成放大', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.resultSrc, {
      title: 'AI 放大对比',
      originalLabel: '原图',
      processedLabel: '放大后'
    });
  },

  saveResult() {
    const src = this.data.resultSrc;
    if (!src) {
      wx.showToast({ title: '请先完成放大', icon: 'none' });
      return;
    }

    const doSave = (filePath) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success() { wx.showToast({ title: '已保存到相册', icon: 'success' }); },
        fail(err) {
          if (err.errMsg && err.errMsg.includes('auth')) {
            wx.showModal({ title: '提示', content: '需要您授权保存图片到相册', showCancel: false });
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' });
          }
        }
      });
    };

    if (src.startsWith('cloud://')) {
      wx.showLoading({ title: '下载中...', mask: true });
      wx.cloud.getTempFileURL({
        fileList: [src],
        success: (urlRes) => {
          const tempUrl = urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL;
          if (!tempUrl) { wx.hideLoading(); wx.showToast({ title: '获取图片地址失败', icon: 'none' }); return; }
          wx.downloadFile({
            url: tempUrl,
            success: (downRes) => { wx.hideLoading(); downRes.tempFilePath ? doSave(downRes.tempFilePath) : wx.showToast({ title: '下载失败', icon: 'none' }); },
            fail: () => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }); }
          });
        },
        fail: () => { wx.hideLoading(); wx.showToast({ title: '获取图片地址失败', icon: 'none' }); }
      });
    } else if (src.startsWith('http://') || src.startsWith('https://')) {
      wx.showLoading({ title: '下载中...', mask: true });
      wx.downloadFile({
        url: src,
        success: (res) => { wx.hideLoading(); res.tempFilePath ? doSave(res.tempFilePath) : wx.showToast({ title: '下载失败', icon: 'none' }); },
        fail: () => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }); }
      });
    } else {
      doSave(src);
    }
  },

  resetAll() {
    this._stopPolling();
    this.setData({
      imageSrc: '',
      fileID: '',
      resultSrc: '',
      resultFileID: '',
      scale: 2,
      denoise: false,
      sharpen: false,
      processing: false,
      progress: 0,
      statusText: '',
      errorMsg: '',
      degraded: false,
      degradeReason: '',
      engine: '',
      engineText: ''
    });
    this._workPath = '';
  },

  onShareAppMessage() {
    return { title: 'AI 图片放大 - 2x/4x 超分辨率增强', path: '/pages/aiUpscale/aiUpscale' };
  }
});
