// pages/pdfToImage/pdfToImage.js
// PDF 转图片 —— 腾讯云数据万象 CI doc-preview（同步，逐页渲染）
//
// 流程：chooseMessageFile 选 PDF（限 20MB）→ uploadFile 拿 fileID →
//      callFunction('pdfToImage') 逐页渲染（page=1 拿总页数，2..N 并发 3）→
//      缩略图网格 → 单张 / 全部保存到相册 → 预览 / 分享
// 诚信：demo 态（CI 未配置）显"示例"角标不渲染；失败态显错误+重试；限流友好提示。
// 限制：小程序只能从微信聊天中选取文件（chooseMessageFile），UI 引导用户先把 PDF 发到聊天。

const MAX_PAGES = 50;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const CONCURRENCY = 3;

Page({
  data: {
    pdfPath: '',          // 本地临时路径
    pdfName: '',
    pdfSize: 0,
    pdfSizeText: '',
    fileID: '',           // 云存储 fileID
    format: 'png',        // 'png' | 'jpg'
    scale: 100,           // 100 标准 | 150 高清
    pages: [],            // [{ page, fileID, tempPath, status:'pending'|'loading'|'done'|'error', error }]
    totalPage: 0,         // 实际可取页数（≤30）
    actualTotalPage: 0,   // 真实总页数（>30 时前端提示）
    converting: false,
    convertProgress: '',
    progressPct: 0,
    demo: false,
    errorMsg: '',
    usedText: ''
  },

  onLoad() {
    this.loadQuota();
  },

  /**
   * 查询今日额度（只读）。CI 未配置 → demo，不展示额度条。
   */
  async loadQuota() {
    try {
      const res = await wx.cloud.callFunction({ name: 'pdfToImage', data: { action: 'quota' } });
      const r = (res && res.result) || {};
      if (r.success && !r.demo) {
        this.setData({ usedText: buildUsedText(r.used, r.limit) });
      }
    } catch (e) {
      console.warn('[pdfToImage] 查询额度失败', e && (e.errMsg || e.message));
    }
  },

  // ============ 选 PDF ============
  choosePdf() {
    if (this.data.converting) return;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf'],
      success: async (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        if (f.size && f.size > MAX_PDF_BYTES) {
          wx.showModal({
            title: '文件过大',
            content: 'PDF 仅支持 50MB 以内，请压缩后重试。',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }
        this.setData({
          pdfPath: f.path,
          pdfName: f.name || 'document.pdf',
          pdfSize: f.size || 0,
          pdfSizeText: formatSize(f.size || 0),
          fileID: '',
          pages: [], totalPage: 0, actualTotalPage: 0,
          demo: false, errorMsg: '', convertProgress: ''
        });
        wx.showLoading({ title: '上传 PDF…', mask: true });
        try {
          const up = await wx.cloud.uploadFile({
            cloudPath: `pdfToImage/src_${Date.now()}.pdf`,
            filePath: f.path
          });
          this.setData({ fileID: up.fileID });
          this.loadQuota();
        } catch (err) {
          console.error('[pdfToImage] 上传失败', err);
          wx.showToast({ title: '上传失败，请重试', icon: 'none' });
          this.setData({ pdfPath: '', pdfName: '', fileID: '' });
        } finally {
          wx.hideLoading();
        }
      },
      fail: (err) => {
        if (err && err.errMsg && !/cancel/i.test(err.errMsg)) {
          wx.showToast({ title: '选择失败', icon: 'none' });
        }
      }
    });
  },

  // ============ 设置 ============
  onFormatChange(e) {
    if (this.data.converting) return;
    const fmt = e.currentTarget.dataset.fmt;
    if (!fmt || fmt === this.data.format) return;
    this.clearResults();
    this.setData({ format: fmt });
  },
  onScaleChange(e) {
    if (this.data.converting) return;
    const sc = Number(e.currentTarget.dataset.sc);
    if (!sc || sc === this.data.scale) return;
    this.clearResults();
    this.setData({ scale: sc });
  },
  clearResults() {
    this.setData({ pages: [], totalPage: 0, actualTotalPage: 0, demo: false, errorMsg: '', convertProgress: '' });
  },

  // ============ 转换 ============
  async startConvert() {
    if (this.data.converting) return;
    if (!this.data.fileID) {
      wx.showToast({ title: '请先选择 PDF', icon: 'none' });
      return;
    }
    this.setData({
      converting: true,
      errorMsg: '',
      demo: false,
      pages: [],
      totalPage: 0,
      actualTotalPage: 0,
      progressPct: 0,
      convertProgress: '正在转换 1/? 页'
    });

    // page=1：拿总页数 + 首页图
    const r1 = await this.callConvert(1);
    if (!r1.success) {
      this.setData({ errorMsg: this.friendlyError(r1), converting: false, convertProgress: '' });
      return;
    }
    if (r1.demo) {
      this.setData({ demo: true, converting: false, convertProgress: '' });
      return;
    }

    const total = Math.min(r1.totalPage || 1, MAX_PAGES);
    const actual = r1.actualTotalPage || total;

    // 初始化 pages 数组
    const pages = [];
    for (let i = 0; i < total; i++) {
      pages.push({ page: i + 1, fileID: '', tempPath: '', status: 'pending', error: '' });
    }
    // page 1 完成
    let dl1Path = '';
    try {
      const dl1 = await wx.cloud.downloadFile({ fileID: r1.fileID });
      dl1Path = dl1.tempFilePath;
      pages[0] = { page: 1, fileID: r1.fileID, tempPath: dl1Path, status: 'done', error: '' };
    } catch (e) {
      pages[0] = { page: 1, fileID: r1.fileID, tempPath: '', status: 'error', error: '图片加载失败' };
    }
    this.setData({
      pages,
      totalPage: total,
      actualTotalPage: actual,
      usedText: buildUsedText(r1.used, r1.limit),
      convertProgress: `正在转换 1/${total} 页`,
      progressPct: Math.round((1 / total) * 100)
    });

    if (total <= 1) {
      this.finishConvert();
      return;
    }
    // 并发取 2..total
    await this.fetchPages(2, total);
    this.finishConvert();
  },

  finishConvert() {
    const done = this.data.pages.filter((p) => p.status === 'done').length;
    const total = this.data.totalPage;
    this.setData({ converting: false, convertProgress: '' });
    if (done === total) {
      wx.showToast({ title: `已转换 ${total} 页`, icon: 'success' });
    } else if (done > 0) {
      wx.showToast({ title: `${done}/${total} 页完成`, icon: 'none' });
    }
  },

  /**
   * 并发池：取 fromPage..toPage（含），并发 CONCURRENCY，逐页更新进度。
   * 遇 rate_limit（额度耗尽）→ 中止剩余队列，提示已转页数，不刷一屏错误。
   */
  async fetchPages(fromPage, toPage) {
    const queue = [];
    for (let p = fromPage; p <= toPage; p++) queue.push(p);
    let completed = fromPage - 1; // page 1 已完成
    const total = toPage;
    const concurrency = Math.min(CONCURRENCY, queue.length);
    let rateLimited = false;

    const worker = async () => {
      while (queue.length && !rateLimited) {
        const page = queue.shift();
        if (page == null) return;
        const ok = await this.convertPage(page);
        if (ok === 'rate_limited') {
          rateLimited = true;
          // 清空剩余队列，标记未转页为跳过
          queue.forEach((p) => this.setPageStatus(p - 1, 'error', '额度不足，未转换'));
          return;
        }
        completed++;
        this.setData({
          convertProgress: `正在转换 ${completed}/${total} 页`,
          progressPct: Math.round((completed / total) * 100)
        });
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (rateLimited) {
      const done = this.data.pages.filter((p) => p.status === 'done').length;
      wx.showModal({
        title: '今日页数额度已用完',
        content: `已转换 ${done} 页，剩余页数请明天再试。`,
        showCancel: false,
        confirmText: '知道了'
      });
    }
  },

  /**
   * @returns {boolean|'rate_limited'} true=成功(含下载失败), false=失败, 'rate_limited'=额度耗尽需中止
   */
  async convertPage(page) {
    const idx = page - 1;
    this.setPageStatus(idx, 'loading');
    const r = await this.callConvert(page);
    if (!r.success) {
      if (r.error === 'rate_limit') {
        this.setPageStatus(idx, 'error', '额度不足，未转换');
        return 'rate_limited';
      }
      this.setPageStatus(idx, 'error', this.friendlyError(r));
      return false;
    }
    if (r.demo) {
      // 中途进入 demo 态（理论上 page1 已拦截，兜底）
      this.setData({ demo: true, converting: false, convertProgress: '' });
      return false;
    }
    // 每页返回 used/limit，实时刷新额度条
    if (r.used != null && r.limit != null) {
      this.setData({ usedText: buildUsedText(r.used, r.limit) });
    }
    try {
      const dl = await wx.cloud.downloadFile({ fileID: r.fileID });
      this.setPageDone(idx, r.fileID, dl.tempFilePath);
    } catch (e) {
      console.error('[pdfToImage] 第', page, '页下载失败', e);
      this.setPageStatus(idx, 'error', '图片加载失败');
    }
    return true;
  },

  async callConvert(page) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'pdfToImage',
        data: {
          action: 'convert',
          fileID: this.data.fileID,
          page,
          format: this.data.format,
          scale: this.data.scale
        }
      });
      return (res && res.result) || {};
    } catch (err) {
      console.error('[pdfToImage] 调用失败 page', page, err);
      return { success: false, error: 'PDF 转换失败，请稍后重试' };
    }
  },

  setPageStatus(idx, status, error) {
    const cur = this.data.pages[idx];
    if (!cur) return;
    this.setData({ [`pages[${idx}]`]: { ...cur, status, error: error || '' } });
  },
  setPageDone(idx, fileID, tempPath) {
    const cur = this.data.pages[idx];
    if (!cur) return;
    this.setData({ [`pages[${idx}]`]: { ...cur, fileID, tempPath, status: 'done', error: '' } });
  },

  friendlyError(r) {
    if (r.error === 'rate_limit') {
      return `今日转换页数额度已用完（${r.used || 0}/${r.limit || 50} 页），请明天再试`;
    }
    return r.error || 'PDF 转换失败，请重试';
  },

  // ============ 预览 / 保存 ============
  onPageTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const cur = this.data.pages[idx];
    if (!cur || cur.status !== 'done') return;
    const urls = this.data.pages.filter((p) => p.status === 'done').map((p) => p.tempPath);
    wx.previewImage({ current: cur.tempPath, urls });
  },

  saveOne(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const page = this.data.pages[idx];
    if (!page || page.status !== 'done') {
      wx.showToast({ title: '该页未就绪', icon: 'none' });
      return;
    }
    this.savePathToAlbum(page.tempPath);
  },

  async saveAll() {
    const done = this.data.pages.filter((p) => p.status === 'done');
    if (!done.length) {
      wx.showToast({ title: '暂无可保存的页面', icon: 'none' });
      return;
    }
    const authed = await this.ensureAlbumAuth();
    if (!authed) return;
    let ok = 0;
    for (let i = 0; i < done.length; i++) {
      wx.showLoading({ title: `保存 ${i + 1}/${done.length}`, mask: true });
      try {
        await saveImageRaw(done[i].tempPath);
        ok++;
      } catch (e) {
        // 跳过失败页
      }
    }
    wx.hideLoading();
    wx.showToast({ title: `已保存 ${ok}/${done.length} 页`, icon: ok === done.length ? 'success' : 'none' });
  },

  ensureAlbumAuth() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          if (res.authSetting['scope.writePhotosAlbum']) {
            resolve(true);
          } else {
            wx.authorize({
              scope: 'scope.writePhotosAlbum',
              success: () => resolve(true),
              fail: () => {
                wx.showModal({
                  title: '提示',
                  content: '需要您授权保存图片到相册',
                  showCancel: false
                });
                resolve(false);
              }
            });
          }
        },
        fail: () => resolve(false)
      });
    });
  },

  savePathToAlbum(filePath) {
    saveImageRaw(filePath)
      .then(() => wx.showToast({ title: '已保存到相册', icon: 'success' }))
      .catch((err) => {
        console.error('[pdfToImage] 保存失败', err);
        if (err && err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({ title: '提示', content: '需要您授权保存图片到相册', showCancel: false });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      });
  },

  reset() {
    this.setData({
      pdfPath: '', pdfName: '', pdfSize: 0, pdfSizeText: '', fileID: '',
      pages: [], totalPage: 0, actualTotalPage: 0,
      converting: false, convertProgress: '',
      demo: false, errorMsg: ''
    });
  },

  onShareAppMessage() {
    return {
      title: 'PDF 一键转图片，逐页高清导出 PNG/JPG',
      path: '/pages/pdfToImage/pdfToImage'
    };
  },

  onShareTimeline() {
    return {
      title: 'PDF 一键转图片，逐页高清导出 PNG/JPG'
    };
  }
});

/**
 * 保存图片到相册（Promise 封装）
 */
function saveImageRaw(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) => reject(err)
    });
  });
}

/**
 * 今日额度文案。仅 CI 可用时云函数返回 used/limit。
 */
function buildUsedText(used, limit) {
  const u = Number(used);
  const l = Number(limit);
  if (!isFinite(u) || !isFinite(l) || l <= 0) return '';
  return `今日已用 ${u}/${l} 页`;
}

/**
 * 文件大小格式化
 */
function formatSize(size) {
  if (!size) return '0 B';
  if (size > 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB';
  if (size > 1024) return (size / 1024).toFixed(2) + ' KB';
  return size + ' B';
}
