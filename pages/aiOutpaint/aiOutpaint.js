// pages/aiOutpaint/aiOutpaint.js
// AI 扩图 —— 按指定宽高比智能扩展画面（腾讯混元 ImageOutpainting，同步 10–30s）
//
// 流程：选图 → guardImage 前端内容安全 → 上传云存储拿 fileID →
//      wx.getImageInfo 算原图比例 → 比例选择器禁用与原图相同项 →
//      callFunction('aiOutpaint') → 结果对比（内嵌左右卡 + compareHelper 滑动对比）→ 保存/分享/重新扩图
// 诚信：demo 态（未配置密钥）结果=原图 + 示例角标；失败态显错误+重试；限流/排队/违规各自友好提示。

const compareHelper = require('../../utils/compare-helper');
const analytics = require('../../utils/analytics');

// 可选扩图比例（与云函数 SUPPORTED_RATIOS 一致）
const RATIOS = [
  { value: '1:1', label: '1:1', desc: '方形' },
  { value: '4:3', label: '4:3', desc: '横版' },
  { value: '3:4', label: '3:4', desc: '竖版' },
  { value: '16:9', label: '16:9', desc: '宽屏' },
  { value: '9:16', label: '9:16', desc: '竖屏' }
];

// 比例相同判定的相对容差（与云函数 isSameRatio 一致）
const RATIO_TOLERANCE = 0.02;

Page({
  data: {
    imageSrc: '',          // 原图本地路径
    fileID: '',            // 原图云存储 fileID
    originalSizeText: '',  // 原图尺寸文案 "宽×高"
    ratios: RATIOS.map(r => ({ ...r, disabled: false })),
    selectedRatio: '',
    resultSrc: '',         // 结果图本地临时路径
    resultFileID: '',
    demo: false,           // 示例态（未配置密钥，结果=原图）
    loading: false,
    errorMsg: '',
    usedText: ''           // 今日额度文案 "今日已用 X/20"
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'aiOutpaint' });
    this.loadQuota();
  },

  /**
   * 查询今日已用额度（只读，不消耗）。进页面时调一次，让额度条提前可见。
   * demo 态（未配置密钥）不展示额度条。
   */
  async loadQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiOutpaint',
        data: { action: 'quota' }
      });
      const r = (res && res.result) || {};
      console.log('[aiOutpaint] quota 返回', r);
      if (r.success && !r.demo) {
        this.setData({ usedText: buildUsedText(r.used, r.limit) });
      }
    } catch (e) {
      // 查询失败不影响主流程，静默（额度条暂不展示，生成后仍会刷新）
      console.warn('[aiOutpaint] 查询额度失败', e && (e.errMsg || e.message));
    }
  },

  /**
   * 图片选择回调（image-uploader change 事件）
   */
  async onImageChange(e) {
    const { paths, count } = e.detail;
    if (count === 0) {
      this.resetAll();
      return;
    }
    const filePath = paths[0];
    this.setData({
      imageSrc: filePath,
      fileID: '',
      resultSrc: '',
      resultFileID: '',
      demo: false,
      errorMsg: ''
    });
    await this.uploadImage(filePath);
  },

  /**
   * 内容安全 + 上传云存储 + 读取原图尺寸 / 比例
   */
  async uploadImage(filePath) {
    const { guardImage } = require('../../utils/content-check');
    if (!(await guardImage(filePath))) {
      // 内容安全拦截，清空已展示的图
      this.setData({ imageSrc: '', fileID: '' });
      const uploader = this.selectComponent('#mainUploader');
      if (uploader && uploader.clear) uploader.clear();
      return;
    }

    wx.showLoading({ title: '上传中...', mask: true });
    try {
      // 上传与读取尺寸并行
      const [uploadRes, info] = await Promise.all([
        wx.cloud.uploadFile({
          cloudPath: `aiOutpaint/src_${Date.now()}.jpg`,
          filePath: filePath
        }),
        this.getImageInfo(filePath)
      ]);

      const ratios = this.buildRatios(info.width, info.height);
      // 默认选第一个非禁用比例；若当前已选仍可用则保留
      let selectedRatio = this.data.selectedRatio;
      const cur = ratios.find(r => r.value === selectedRatio);
      if (!selectedRatio || (cur && cur.disabled)) {
        selectedRatio = (ratios.find(r => !r.disabled) || {}).value || '';
      }

      this.setData({
        fileID: uploadRes.fileID,
        originalSizeText: info.width ? `${info.width}×${info.height}` : '',
        ratios,
        selectedRatio
      });
    } catch (err) {
      console.error('[aiOutpaint] 上传失败', err);
      wx.showToast({ title: '上传失败，请重试', icon: 'none' });
      this.setData({ imageSrc: '', fileID: '' });
    } finally {
      wx.hideLoading();
    }
  },

  getImageInfo(filePath) {
    return new Promise((resolve) => {
      wx.getImageInfo({
        src: filePath,
        success: (res) => resolve({ width: res.width, height: res.height }),
        fail: () => resolve({ width: 0, height: 0 })
      });
    });
  },

  /**
   * 根据原图宽高构造比例列表，标注与原图相同的项为 disabled
   */
  buildRatios(w, h) {
    const matchValue = computeRatioMatch(w, h);
    return RATIOS.map(r => ({ ...r, disabled: r.value === matchValue }));
  },

  selectRatio(e) {
    const value = e.currentTarget.dataset.ratio;
    const item = this.data.ratios.find(r => r.value === value);
    if (!item) return;
    if (item.disabled) {
      wx.showToast({ title: '该比例与原图相同，请换一个', icon: 'none' });
      return;
    }
    this.setData({ selectedRatio: value, resultSrc: '', resultFileID: '', demo: false, errorMsg: '' });
  },

  /**
   * 调云函数扩图
   */
  async startOutpaint() {
    const { fileID, selectedRatio, loading } = this.data;
    if (loading) return;
    if (!fileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    if (!selectedRatio) {
      wx.showToast({ title: '请选择扩图比例', icon: 'none' });
      return;
    }

    this.setData({ loading: true, errorMsg: '' });
    wx.showLoading({ title: 'AI 扩图中…', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiOutpaint',
        data: { fileID, ratio: selectedRatio }
      });
      wx.hideLoading();

      const r = (res && res.result) || {};
      console.log('[aiOutpaint] outpaint 返回', r);
      if (r.success) {
        if (r.demo) {
          // 示例态：未配置密钥，结果=原图
          this.setData({
            resultSrc: this.data.imageSrc,
            resultFileID: fileID,
            demo: true,
            loading: false
          });
          return;
        }
        // 真实结果：下载 fileID → 本地路径展示
        wx.showLoading({ title: '加载结果…', mask: true });
        const dl = await wx.cloud.downloadFile({ fileID: r.fileID });
        wx.hideLoading();
        this.setData({
          resultSrc: dl.tempFilePath,
          resultFileID: r.fileID,
          demo: false,
          loading: false,
          usedText: buildUsedText(r.used, r.limit)
        });
        analytics.track('tool_complete', { toolId: 'aiOutpaint' });
      } else {
        this.setData({
          loading: false,
          errorMsg: this.friendlyError(r),
          usedText: buildUsedText(r.used, r.limit)
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[aiOutpaint] 调用失败', err);
      this.setData({ loading: false, errorMsg: '扩图失败，请稍后重试' });
    }
  },

  /**
   * 把云函数返回的失败结果映射为面向用户的文案
   */
  friendlyError(r) {
    if (r.error === 'rate_limit') {
      return `今日扩图额度已用完（${r.used || 0}/${r.limit || 20}），请明天再试`;
    }
    return r.error || '扩图失败，请重试';
  },

  previewOriginalImage() {
    if (!this.data.imageSrc) return;
    wx.previewImage({ current: this.data.imageSrc, urls: [this.data.imageSrc, this.data.resultSrc].filter(Boolean) });
  },

  previewResultImage() {
    if (!this.data.resultSrc) {
      wx.showToast({ title: '暂无结果图片', icon: 'none' });
      return;
    }
    wx.previewImage({ current: this.data.resultSrc, urls: [this.data.imageSrc, this.data.resultSrc].filter(Boolean) });
  },

  saveResult() {
    if (!this.data.resultSrc) {
      wx.showToast({ title: '请先完成扩图', icon: 'none' });
      return;
    }
    wx.getSetting({
      success: (res) => {
        if (!res.authSetting['scope.writePhotosAlbum']) {
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: () => this.saveImageToAlbum(this.data.resultSrc),
            fail: () => wx.showModal({
              title: '提示',
              content: '需要您授权保存图片到相册',
              showCancel: false
            })
          });
        } else {
          this.saveImageToAlbum(this.data.resultSrc);
        }
      }
    });
  },

  saveImageToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err) => {
        console.error('[aiOutpaint] 保存失败', err);
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({ title: '提示', content: '需要您授权保存图片到相册', showCancel: false });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  },

  /**
   * 对比查看（跳转 compare 滑动对比页）
   */
  onCompare() {
    if (!this.data.imageSrc || !this.data.resultSrc) {
      wx.showToast({ title: '请先完成扩图', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.resultSrc, {
      title: '扩图对比',
      processedLabel: '扩图后'
    });
  },

  /**
   * 重新扩图：清空结果，回到选比例 + 生成态
   */
  resetAndReselect() {
    this.setData({ resultSrc: '', resultFileID: '', demo: false, errorMsg: '' });
  },

  resetAll() {
    this.setData({
      imageSrc: '', fileID: '', originalSizeText: '',
      resultSrc: '', resultFileID: '', demo: false,
      errorMsg: '', selectedRatio: '', usedText: '',
      ratios: RATIOS.map(r => ({ ...r, disabled: false }))
    });
  },

  onImageLoad() {},

  onImageError(e) {
    console.error('[aiOutpaint] 结果图加载失败', e.detail);
    wx.showToast({ title: '图片加载失败', icon: 'none', duration: 2000 });
  },

  onShareAppMessage() {
    analytics.trackShare('aiOutpaint', 'friend');
    return {
      title: '用 AI 一键扩图，智能补全画面背景',
      path: '/pages/aiOutpaint/aiOutpaint',
      imageUrl: this.data.resultSrc || this.data.imageSrc || ''
    };
  },

  onShareTimeline() {
    analytics.trackShare('aiOutpaint', 'timeline');
    return {
      title: 'AI 扩图：按比例智能补全背景',
      imageUrl: this.data.resultSrc || this.data.imageSrc || ''
    };
  }
});

/**
 * 构造今日额度文案。仅密钥可用时云函数才返回 used/limit；缺失则返回空串（不展示）。
 */
function buildUsedText(used, limit) {
  const u = Number(used);
  const l = Number(limit);
  if (!isFinite(u) || !isFinite(l) || l <= 0) return '';
  return `今日已用 ${u}/${l} 次`;
}

/**
 * 找出与原图宽高最接近的比例；相对差 < RATIO_TOLERANCE 视为"当前比例"（需禁用）。
 * 返回比例 value（如 '4:3'）或 null（无近似匹配）。
 */
function computeRatioMatch(w, h) {
  if (!w || !h) return null;
  const actual = w / h;
  let closest = null;
  let minRel = Infinity;
  RATIOS.forEach(r => {
    const parts = r.value.split(':').map(Number);
    const rv = parts[0] / parts[1];
    const rel = Math.abs(actual - rv) / rv;
    if (rel < minRel) { minRel = rel; closest = r.value; }
  });
  return minRel < RATIO_TOLERANCE ? closest : null;
}
