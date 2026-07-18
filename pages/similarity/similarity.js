// pages/similarity/similarity.js - 找重复图（双图相似度 + 多图批量查重）
//
// 诚实声明：本功能基于感知哈希（pHash/dHash/aHash）的「像素级近似检测」，
// 能识别压缩、缩放、轻微修改后的重复图；不识别内容语义相似（同主体不同姿态等）。
// 算法见 utils/image-hash.js，纯本地、零成本。

const imageProcess = require('../../utils/image-process');
const imageHash = require('../../utils/image-hash');
const analytics = require('../../utils/analytics');

// 阈值档位（pHash 汉明距离 0-64，越小越严格）
const THRESHOLDS = [
  { key: 'loose',  label: '宽松', value: 18, desc: '容忍较大差异，疑似重复较多' },
  { key: 'normal', label: '标准', value: 12, desc: '推荐，平衡误判与漏判' },
  { key: 'strict', label: '严格', value: 6,  desc: '几乎只认高度近似图' }
];

const DEFAULT_THRESHOLD_KEY = 'normal';

const MAX_BATCH = 9; // 受小程序单次选图上限约束

Page({
  data: {
    mode: 'pair', // pair | batch
    // 双图模式
    imageA: '',
    imageB: '',
    pairLoading: false,
    pairResult: null, // { score, level:{label,tone}, aDist, dDist, pDist }
    // 批量模式
    batchList: [], // [{ path }]
    thresholdKey: DEFAULT_THRESHOLD_KEY,
    thresholds: THRESHOLDS,
    batchLoading: false,
    progress: { done: 0, total: 0, show: false },
    batchResult: null // { groups, duplicateGroupCount, duplicateCount, uniqueCount, errorCount }
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'similarity' });
  },

  // ============== 模式切换 ==============
  onModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.setData({ mode });
  },

  // ============== 双图模式：选图 / 移除 ==============
  onPickA() {
    this._pickOne('imageA');
  },
  onPickB() {
    this._pickOne('imageB');
  },
  _pickOne(key) {
    imageProcess.chooseImage(1).then((paths) => {
      if (paths && paths[0]) {
        this.setData({ [key]: paths[0], pairResult: null });
      }
    }).catch(() => {}); // 用户取消等，静默
  },
  onRemoveA() {
    this.setData({ imageA: '', pairResult: null });
  },
  onRemoveB() {
    this.setData({ imageB: '', pairResult: null });
  },

  // ============== 双图模式：对比 ==============
  onCompare() {
    const { imageA, imageB } = this.data;
    if (!imageA || !imageB) {
      wx.showToast({ title: '请选择两张图片', icon: 'none' });
      return;
    }
    this.setData({ pairLoading: true, pairResult: null });
    imageHash.comparePair(imageA, imageB).then((res) => {
      this.setData({ pairLoading: false, pairResult: res });
      analytics.track('tool_complete', { toolId: 'similarity' });
    }).catch((err) => {
      console.error('[similarity] 对比失败', err);
      this.setData({ pairLoading: false });
      wx.showToast({ title: '对比失败，请重试', icon: 'none' });
    });
  },

  // ============== 批量模式：选图 / 移除 ==============
  onPickBatch() {
    const remain = MAX_BATCH - this.data.batchList.length;
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${MAX_BATCH} 张`, icon: 'none' });
      return;
    }
    imageProcess.chooseImage(remain).then((paths) => {
      if (!paths || !paths.length) return;
      const list = this.data.batchList.concat(paths.map((p) => ({ path: p })));
      this.setData({ batchList: list.slice(0, MAX_BATCH), batchResult: null });
    }).catch(() => {});
  },
  onRemoveBatchItem(e) {
    const idx = e.currentTarget.dataset.index;
    const list = this.data.batchList.slice();
    list.splice(idx, 1);
    this.setData({ batchList: list, batchResult: null });
  },
  onClearBatch() {
    this.setData({ batchList: [], batchResult: null });
  },

  // ============== 批量模式：阈值切换 ==============
  onThresholdChange(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ thresholdKey: key, batchResult: null });
  },

  // ============== 批量模式：查重 ==============
  onCheckBatch() {
    const { batchList, thresholdKey } = this.data;
    if (batchList.length < 2) {
      wx.showToast({ title: '至少选择 2 张图片', icon: 'none' });
      return;
    }
    const threshold = THRESHOLDS.find((t) => t.key === thresholdKey).value;
    const paths = batchList.map((b) => b.path);

    this.setData({
      batchLoading: true,
      batchResult: null,
      progress: { done: 0, total: paths.length, show: true }
    });

    // 串行算哈希 + 进度回调（imageHash.runBatch 内部已控制并发/让出事件循环）
    imageHash.runBatch(paths, {
      onProgress: (done, total) => {
        this.setData({ progress: { done, total, show: true } });
      }
    }).then((hashes) => {
      const result = imageHash.buildGroups(hashes, threshold);
      this.setData({ batchLoading: false, progress: { done: paths.length, total: paths.length, show: false }, batchResult: result });
      analytics.track('tool_complete', { toolId: 'similarity' });
      if (result.errorCount > 0) {
        wx.showToast({ title: `${result.errorCount} 张处理失败已跳过`, icon: 'none' });
      }
    }).catch((err) => {
      console.error('[similarity] 批量查重失败', err);
      this.setData({ batchLoading: false, progress: { done: 0, total: 0, show: false } });
      wx.showToast({ title: '查重失败，请重试', icon: 'none' });
    });
  },

  // ============== 预览 ==============
  onPreviewImage(e) {
    const { url, list } = e.currentTarget.dataset;
    let urls = [url];
    if (Array.isArray(list)) {
      // list 元素可能是字符串（双图）或对象 {path}（批量），统一提取并过滤空
      urls = list
        .map((u) => (typeof u === 'string' ? u : (u && u.path) || ''))
        .filter(Boolean);
    }
    if (!url) return;
    wx.previewImage({ current: url, urls });
  },

  onShareAppMessage() {
    analytics.trackShare('similarity', 'friend');
    return {
      title: '找重复图：双图相似度对比，多图批量查重',
      path: '/pages/similarity/similarity'
    };
  },

  onShareTimeline() {
    analytics.trackShare('similarity', 'timeline');
    return { title: '图片查重：找出相册里的重复图' };
  }
});
