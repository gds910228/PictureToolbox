// pages/imgToPdf/imgToPdf.js
// 多图合成 PDF 工具
// - 多选图片，按文件名自然排序
// - 支持页面尺寸 (A4 / 16:9 / 1:1) 和页边距
// - 调用 imgToPdf 云函数生成 PDF (基于 pdf-lib，开源免费)
// - 返回 fileID 后可下载到本地

const PAGE_SIZE_OPTIONS = [
  { key: 'A4',   label: 'A4',     desc: '210 × 297 mm (推荐)' },
  { key: '16:9', label: '16:9',   desc: '宽屏比例' },
  { key: '1:1',  label: '1:1',    desc: '正方形' }
];

const analytics = require('../../utils/analytics');

Page({
  data: {
    images: [],              // [{ path, name, size }]
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    pageSize: 'A4',
    margin: 36,              // pt
    marginMin: 0,
    marginMax: 100,
    generating: false,
    progressText: '',
    resultFileID: '',
    resultPath: '',          // 下载到本地后的临时路径
    resultPageCount: 0,
    resultSize: 0,
    resultSizeText: '',
    cloudEnabled: false,
    filename: ''
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'imgToPdf' });
    // 复用 app.js 中已初始化的云开发实例
    if (wx.cloud) {
      this.setData({ cloudEnabled: true });
    } else {
      this.setData({ cloudEnabled: false });
    }
    this.setData({ filename: this.defaultFilename() });
  },

  defaultFilename() {
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `images_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  },

  // ============ 图片选择 ============
  chooseImages() {
    const that = this;
    wx.chooseMedia({
      count: 30 - that.data.images.length, // 总共最多 30 张
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['compressed'],
      success(res) {
        const incoming = res.tempFiles.map((f) => ({
          path: f.tempFilePath,
          name: that.extractName(f.tempFilePath),
          size: f.size || 0
        }));
        // 合并并按文件名排序（自然顺序）
        const all = that.data.images.concat(incoming);
        all.sort((a, b) => that.naturalCompare(a.name, b.name));
        that.setData({ images: all });
        wx.showToast({
          title: `已选 ${all.length} 张`,
          icon: 'none',
          duration: 1200
        });
      },
      fail(err) {
        if (err && err.errMsg && !/cancel/i.test(err.errMsg)) {
          wx.showToast({ title: '选择失败', icon: 'none' });
        }
      }
    });
  },

  extractName(p) {
    if (!p) return '';
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
  },

  // 自然排序，对 img1, img2, img10 这样的命名友好
  naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  },

  removeImage(e) {
    const idx = e.currentTarget.dataset.index;
    const arr = this.data.images.slice();
    arr.splice(idx, 1);
    this.setData({ images: arr });
  },

  previewLocal(e) {
    const idx = e.currentTarget.dataset.index;
    const urls = this.data.images.map((i) => i.path);
    wx.previewImage({ current: urls[idx], urls });
  },

  moveUp(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx <= 0) return;
    const arr = this.data.images.slice();
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    this.setData({ images: arr });
  },

  moveDown(e) {
    const idx = e.currentTarget.dataset.index;
    const arr = this.data.images.slice();
    if (idx >= arr.length - 1) return;
    [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
    this.setData({ images: arr });
  },

  reSortByName() {
    const arr = this.data.images.slice();
    arr.sort((a, b) => this.naturalCompare(a.name, b.name));
    this.setData({ images: arr });
    wx.showToast({ title: '已按文件名排序', icon: 'none' });
  },

  clearAll() {
    const that = this;
    wx.showModal({
      title: '提示',
      content: '确定清空已选图片？',
      success(res) {
        if (res.confirm) {
          that.setData({
            images: [],
            resultFileID: '',
            resultPath: '',
            resultPageCount: 0,
            resultSize: 0,
            resultSizeText: ''
          });
        }
      }
    });
  },

  // ============ 设置 ============
  onPageSizeTap(e) {
    this.setData({ pageSize: e.currentTarget.dataset.key });
  },

  onMarginChange(e) {
    this.setData({ margin: e.detail.value });
  },

  onFilenameInput(e) {
    this.setData({ filename: e.detail.value });
  },

  // ============ 生成 PDF ============
  async startGenerate() {
    if (!this.data.images.length) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '当前不支持云开发', icon: 'none' });
      return;
    }

    this.setData({
      generating: true,
      progressText: '正在上传图片...',
      resultFileID: '',
      resultPath: ''
    });

    wx.showLoading({ title: '上传图片中...', mask: true });

    try {
      // 1. 逐张上传到云存储
      const fileIDs = [];
      for (let i = 0; i < this.data.images.length; i++) {
        const img = this.data.images[i];
        wx.showLoading({
          title: `上传 ${i + 1}/${this.data.images.length}`,
          mask: true
        });
        const cloudPath = `imgToPdf/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}-${this.sanitize(img.name)}`;
        const up = await wx.cloud.uploadFile({
          cloudPath,
          filePath: img.path
        });
        fileIDs.push(up.fileID);
      }

      // 2. 调用云函数
      wx.showLoading({ title: '生成 PDF...', mask: true });
      const filename = (this.data.filename || '').trim() || this.defaultFilename();
      const callRes = await wx.cloud.callFunction({
        name: 'imgToPdf',
        data: {
          fileIDs,
          pageSize: this.data.pageSize,
          margin: Number(this.data.margin) || 0,
          filename
        }
      });

      wx.hideLoading();

      const result = callRes.result || {};
      if (!result.success) {
        throw new Error(result.error || 'PDF 生成失败');
      }

      this.setData({
        resultFileID: result.fileID,
        resultPageCount: result.pageCount || 0,
        resultSize: result.pdfSize || 0,
        resultSizeText: this.formatSize(result.pdfSize || 0),
        generating: false,
        progressText: ''
      });
      analytics.track('tool_complete', { toolId: 'imgToPdf' });

      wx.showToast({
        title: `已生成 ${result.pageCount} 页`,
        icon: 'success'
      });

      // 后台清理上传到云的原图（节省存储）
      this.cleanupUploaded(fileIDs);
    } catch (err) {
      wx.hideLoading();
      console.error('[imgToPdf] 生成失败', err);
      this.setData({ generating: false, progressText: '' });
      wx.showModal({
        title: '生成失败',
        content: err.message || '请检查网络或云函数是否已部署',
        showCancel: false
      });
    }
  },

  async cleanupUploaded(fileIDs) {
    if (!fileIDs || !fileIDs.length) return;
    try {
      await wx.cloud.deleteFile({ fileList: fileIDs });
    } catch (e) {
      console.warn('[imgToPdf] 清理失败（不影响主流程）', e);
    }
  },

  // ============ 下载 PDF ============
  async downloadPdf() {
    if (!this.data.resultFileID) return;
    wx.showLoading({ title: '下载中...', mask: true });
    try {
      const res = await wx.cloud.downloadFile({ fileID: this.data.resultFileID });
      wx.hideLoading();
      this.setData({ resultPath: res.tempFilePath });
      wx.showToast({ title: '下载完成', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('[imgToPdf] 下载失败', err);
      wx.showToast({ title: '下载失败', icon: 'none' });
    }
  },

  async openPdf() {
    let tempPath = this.data.resultPath;
    if (!tempPath) {
      // 没下载过，先下载
      try {
        wx.showLoading({ title: '下载中...', mask: true });
        const res = await wx.cloud.downloadFile({ fileID: this.data.resultFileID });
        tempPath = res.tempFilePath;
        this.setData({ resultPath: tempPath });
        wx.hideLoading();
      } catch (err) {
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
        return;
      }
    }
    wx.openDocument({
      filePath: tempPath,
      fileType: 'pdf',
      showMenu: true,
      success() {
      },
      fail(err) {
        console.error('打开失败', err);
        wx.showToast({ title: '打开失败', icon: 'none' });
      }
    });
  },

  async savePdfToDevice() {
    if (!this.data.resultFileID) return;
    try {
      let tempPath = this.data.resultPath;
      if (!tempPath) {
        wx.showLoading({ title: '下载中...', mask: true });
        const res = await wx.cloud.downloadFile({ fileID: this.data.resultFileID });
        tempPath = res.tempFilePath;
        this.setData({ resultPath: tempPath });
        wx.hideLoading();
      }
      // 微信小程序无 saveFileToAlbum 支持非媒体，但可以将文件保存到 wx.saveFile
      wx.saveFile({
        tempFilePath: tempPath,
        success(r) {
          wx.showModal({
            title: '已保存到小程序文件系统',
            content: '路径：' + r.savedFilePath + '\n\n可通过"打开 PDF"按钮查看，或转发到对话。',
            showCancel: false
          });
        },
        fail() {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      });
    } catch (err) {
      wx.hideLoading();
      console.error('[imgToPdf] 保存失败', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  reset() {
    this.setData({
      images: [],
      resultFileID: '',
      resultPath: '',
      resultPageCount: 0,
      resultSize: 0,
      resultSizeText: '',
      filename: this.defaultFilename()
    });
  },

  // ============ 工具方法 ============
  sanitize(name) {
    return String(name || '').replace(/[^\w\u4e00-\u9fa5\-.]/g, '_').slice(0, 60);
  },

  formatSize(size) {
    if (!size) return '0 B';
    if (size > 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB';
    if (size > 1024) return (size / 1024).toFixed(2) + ' KB';
    return size + ' B';
  },

  onShareAppMessage() {
    analytics.trackShare('imgToPdf', 'friend');
    return {
      title: '多图合成 PDF：照片按序拼成 A4 文档',
      path: '/pages/imgToPdf/imgToPdf'
    };
  },

  onShareTimeline() {
    analytics.trackShare('imgToPdf', 'timeline');
    return { title: '多张照片一键合成 PDF 文档' };
  }
});
