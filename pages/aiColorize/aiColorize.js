// pages/aiColorize/aiColorize.js
// AI 老照片上色 —— 上传 → 黑白检测 → 风格选择 → 提交任务 → 轮询结果 → 对比/保存
// 约束：云端不可用时直接提示「当前服务繁忙，请稍后再试」，不做本地 Canvas 伪上色。

const compareHelper = require('../../utils/compare-helper');
const { ensureBounded } = require('../../utils/upscale-local'); // 通用最长边限制工具
const { detectGrayscale } = require('../../utils/colorize-detect');

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 入口文件大小上限 20MB
const POLL_INTERVAL = 3000;               // 轮询间隔 3s
const POLL_MAX = 50;                      // 最多轮询 50 次（约 2.5 分钟，DeOldify 通常 3 分钟内完成）

Page({
  data: {
    // 图片
    imageSrc: '',        // 原图（展示与对比）
    fileID: '',          // 已上传工作图 fileID
    resultSrc: '',       // 结果图（cloud:// / 临时路径）
    resultFileID: '',

    // 风格
    style: 'natural',   // natural | vintage
    styleName: '自然',

    // 黑白检测
    colorHint: '',
    isColorImage: false,

    // 状态
    processing: false,
    progress: 0,
    statusText: '',
    errorMsg: '',

    // 结果信息
    engine: '',
    engineText: ''
  },

  onLoad() {
    this._pollTimer = null;
    this._pollCount = 0;
    this._workPath = ''; // 限边后的工作图本地路径
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
          colorHint: '',
          isColorImage: false,
          errorMsg: ''
        });
        that.prepareAndUpload(file.tempFilePath);
      }
    });
  },

  async prepareAndUpload(filePath) {
    const that = this;
    wx.showLoading({ title: '处理图片中...', mask: true });

    // 1) 最长边限制到 1440（控制 DeOldify 推理成本/时长与内存）
    let workPath = filePath;
    try {
      const bounded = await ensureBounded(filePath, 1440);
      workPath = bounded.path;
    } catch (e) {
      console.warn('[aiColorize] ensureBounded 失败，使用原图', e);
    }

    // 2) 黑白/灰度检测（友好提示，不阻断）
    try {
      const r = await detectGrayscale(workPath);
      this.setData({ colorHint: r.hint, isColorImage: r.isColor });
    } catch (e) {
      console.warn('[aiColorize] 黑白检测异常，跳过', e);
    }

    // 3) 内容安全检测（违规内部已弹标准提示，不暴露原因）
    try {
      const { guardImage } = require('../../utils/content-check');
      if (!(await guardImage(workPath))) {
        this.setData({ imageSrc: '', fileID: '' });
        wx.hideLoading();
        return;
      }
    } catch (e) {
      console.warn('[aiColorize] 内容安全检测异常，继续', e);
    }

    this._workPath = workPath;
    wx.hideLoading();
    wx.showLoading({ title: '上传中...', mask: true });

    const cloudPath = `aiColorize/${Date.now()}.jpg`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath: workPath,
      success: (res) => {
        that.setData({ fileID: res.fileID });
        wx.hideLoading();
      },
      fail: (err) => {
        console.error('[aiColorize] 上传失败', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  // ============================================================
  // 步骤 2：风格选择
  // ============================================================
  selectStyle(e) {
    const style = e.currentTarget.dataset.style;
    const name = style === 'vintage' ? '复古' : '自然';
    this.setData({ style, styleName: name, resultSrc: '', resultFileID: '', errorMsg: '' });
  },

  // ============================================================
  // 步骤 3：开始上色
  // ============================================================
  async startColorize() {
    if (this.data.processing) return;
    if (!this.data.imageSrc) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }

    // 彩色图二次确认（约束：非黑白给出友好提示但允许继续）
    if (this.data.isColorImage) {
      const ok = await new Promise((resolve) => {
        wx.showModal({
          title: '提示',
          content: (this.data.colorHint || '图片已有色彩') + '，确定继续上色吗？',
          confirmText: '继续',
          cancelText: '换一张',
          success: (r) => resolve(r.confirm)
        });
      });
      if (!ok) return;
    }

    if (!this.data.fileID) {
      wx.showToast({ title: '图片未就绪，请稍候', icon: 'none' });
      return;
    }

    this._pollCount = 0;
    this.setData({
      processing: true,
      progress: 8,
      statusText: '正在提交上色任务...',
      errorMsg: '',
      resultSrc: '',
      resultFileID: '',
      engine: '',
      engineText: ''
    });

    // 提交 AI 任务
    let submitRes;
    try {
      submitRes = await wx.cloud.callFunction({
        name: 'aiColorize',
        data: { action: 'submit', fileID: this.data.fileID, style: this.data.style }
      });
    } catch (e) {
      console.error('[aiColorize] 提交云函数失败', e);
      this._fail('当前服务繁忙，请稍后再试');
      return;
    }

    const r = (submitRes && submitRes.result) || {};
    if (!r.success || !r.taskId) {
      // 云端不可用 / 提交失败 → 直接报繁忙（不降级伪上色）
      this._fail(r.reason || '当前服务繁忙，请稍后再试');
      return;
    }

    // AI 模式：轮询
    this._startPolling(r.taskId);
  },

  _fail(msg) {
    this._stopPolling();
    this.setData({ processing: false, progress: 0, errorMsg: msg || '处理失败' });
    wx.showToast({ title: msg || '处理失败', icon: 'none', duration: 2500 });
  },

  // ============================================================
  // 轮询 AI 任务
  // ============================================================
  _startPolling(taskId) {
    const that = this;
    this.setData({ statusText: 'AI 上色中，请耐心等待...' });

    const tick = async () => {
      that._pollCount += 1;
      if (that._pollCount > POLL_MAX) {
        that._stopPolling();
        that._fail('AI 处理超时，请稍后重试');
        return;
      }

      // 进度模拟：每次 +4，封顶 92
      that.setData({
        progress: Math.min(92, 20 + that._pollCount * 4),
        statusText: `AI 上色中...（已等待 ${that._pollCount * 3}s）`
      });

      let res;
      try {
        res = await wx.cloud.callFunction({
          name: 'aiColorize',
          data: { action: 'query', taskId }
        });
      } catch (e) {
        console.warn('[aiColorize] 查询失败，稍后重试', e);
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
          engine: r.engine || 'replicate-deoldify',
          engineText: 'AI 上色'
        });
        return;
      }

      if (r.status === 'failed') {
        that._stopPolling();
        that._fail(r.reason || '当前服务繁忙，请稍后再试');
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
      wx.showToast({ title: '请先完成上色', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.resultSrc, {
      title: 'AI 上色对比',
      originalLabel: '原图',
      processedLabel: '上色后'
    });
  },

  saveResult() {
    const src = this.data.resultSrc;
    if (!src) {
      wx.showToast({ title: '请先完成上色', icon: 'none' });
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
      style: 'natural',
      styleName: '自然',
      colorHint: '',
      isColorImage: false,
      processing: false,
      progress: 0,
      statusText: '',
      errorMsg: '',
      engine: '',
      engineText: ''
    });
    this._workPath = '';
  },

  onShareAppMessage() {
    return { title: 'AI 老照片上色 - 让黑白老照片重焕色彩', path: '/pages/aiColorize/aiColorize' };
  }
});
