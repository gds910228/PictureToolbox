// pkgGif/pages/gifReport/gifReport.js
// GIF 导出报告：历史列表、趋势概览、详情、对比、文字摘要复制。
const report = require('../../utils/gif-report');
const analytics = require('../../../utils/analytics');

const STORAGE_KEY = 'gif_export_reports';

Page({
  data: {
    records: [],
    agg: null,
    pop: null,
    trendText: '',
    selectedId: null,
    selectedRecord: null,
    compareIds: [],
    compareResult: '',
    canvasWidth: 0,
    canvasHeight: 0
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'gifReport' });
    this._loadRecords();
    const sysInfo = wx.getSystemInfoSync();
    this.setData({
      canvasWidth: sysInfo.windowWidth - 64,
      canvasHeight: 160
    });
  },

  _formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  },

  _loadRecords() {
    let store;
    try {
      const raw = wx.getStorageSync(STORAGE_KEY);
      store = report.deserialize(raw);
    } catch (e) {
      store = report.createStore();
    }
    const aggRaw = report.aggregate(store);
    const pop = report.periodOverPeriod(store);
    const trendText = report.formatTrendSummary(store);

    // 预计算 WXML 显示值（WXML 不支持 .toFixed() 等方法调用）
    const agg = this._buildAgg(aggRaw);

    // 倒序显示（最新在前），预计算每条记录的显示字段
    // 注意：outputSize/matchRate 等原始数值字段必须保留——
    // viewDetail 的 formatRecordSummary 与趋势图 y 值都依赖它们（曾因剥离导致 NaN）
    const compareIds = this.data.compareIds || [];
    const records = store.records.slice().reverse().map(r => ({
      id: r.id,
      tool: r.tool,
      timestamp: r.timestamp,
      timeText: this._formatTime(r.timestamp),
      operations: r.operations,
      outputWidth: r.outputWidth,
      outputHeight: r.outputHeight,
      outputFrameCount: r.outputFrameCount,
      outputSize: r.outputSize,
      outputSizeText: this._formatBytes(r.outputSize),
      sourceSize: r.sourceSize,
      sourceWidth: r.sourceWidth,
      sourceHeight: r.sourceHeight,
      sourceFrameCount: r.sourceFrameCount,
      matchRate: r.matchRate,
      durationMs: r.durationMs,
      compressionStrategy: r.compressionStrategy,
      ratioText: r.sourceSize > 0 ? Math.round(r.outputSize / r.sourceSize * 100) + '%' : '',
      isComparing: compareIds.indexOf(r.id) >= 0
    }));

    // 原始 store 放实例字段，不进 setData（避免双重序列化，也避免脏数据）
    this._store = store;
    this.setData({ records, agg, pop, trendText });
    if (records.length > 0) {
      this._drawTrendChart(records);
    }
  },

  _buildAgg(aggRaw) {
    return {
      totalExports: aggRaw.totalExports,
      totalSavedText: this._formatBytes(aggRaw.totalSavedBytes),
      avgRatioText: (aggRaw.averageCompressionRatio * 100).toFixed(1) + '%',
      avgMatchText: Math.round(aggRaw.averageMatchRate * 100) + '%',
      averageDurationMs: Math.round(aggRaw.averageDurationMs)
    };
  },

  _formatTime(ts) {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },

  _drawTrendChart(records) {
    const query = wx.createSelectorQuery().in(this);
    query.select('#trendCanvas').fields({ node: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = (wx.getSystemInfoSync().pixelRatio) || 2;
      const W = this.data.canvasWidth, H = this.data.canvasHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      if (records.length < 2) return;
      const chronological = records.slice().reverse();
      const sizes = chronological.map(r => r.outputSize);
      const maxSize = Math.max.apply(null, sizes);
      const minSize = Math.min.apply(null, sizes);
      const range = maxSize - minSize || 1;

      // 折线图：输出体积趋势
      ctx.strokeStyle = '#00F0FF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const pad = 30;
      for (let i = 0; i < sizes.length; i++) {
        const x = pad + (W - pad * 2) * i / (sizes.length - 1);
        const y = H - pad - (H - pad * 2) * (sizes[i] - minSize) / range;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 数据点
      ctx.fillStyle = '#FF0080';
      for (let i = 0; i < sizes.length; i++) {
        const x = pad + (W - pad * 2) * i / (sizes.length - 1);
        const y = H - pad - (H - pad * 2) * (sizes[i] - minSize) / range;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 标签
      ctx.fillStyle = '#ADB5BD';
      ctx.font = '10px sans-serif';
      ctx.fillText(report.formatBytes(minSize), 2, H - 4);
      ctx.fillText(report.formatBytes(maxSize), 2, 12);
    });
  },

  viewDetail(e) {
    const id = e.currentTarget.dataset.id;
    const rec = this.data.records.find(r => r.id === id);
    if (!rec) return;
    const text = report.formatRecordSummary(rec);
    this.setData({ selectedRecord: rec, selectedText: text });
  },

  closeDetail() {
    this.setData({ selectedRecord: null, selectedText: '' });
  },

  copySummary() {
    if (!this.data.selectedText) return;
    wx.setClipboardData({
      data: this.data.selectedText,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  copyTrend() {
    wx.setClipboardData({
      data: this.data.trendText,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  toggleCompare(e) {
    const id = e.currentTarget.dataset.id;
    let ids = this.data.compareIds.slice();
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else {
      if (ids.length >= 2) ids.shift();
      ids.push(id);
    }
    let compareResult = '';
    if (ids.length === 2) {
      const store = this._store;
      const a = store.records.find(r => r.id === ids[0]);
      const b = store.records.find(r => r.id === ids[1]);
      if (a && b) compareResult = report.formatComparison(a, b);
    }
    // 更新列表中的 isComparing 标记
    const records = this.data.records.map(r => ({
      ...r,
      isComparing: ids.indexOf(r.id) >= 0
    }));
    this.setData({ compareIds: ids, compareResult, records });
  },

  copyCompare() {
    if (!this.data.compareResult) return;
    wx.setClipboardData({
      data: this.data.compareResult,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  clearHistory() {
    wx.showModal({
      title: '清空报告',
      content: '将删除所有导出报告记录，此操作不可撤销。',
      success: (r) => {
        if (!r.confirm) return;
        wx.removeStorageSync(STORAGE_KEY);
        this._store = report.createStore();
        this.setData({
          records: [], agg: this._buildAgg(report.aggregate(this._store)),
          pop: null, trendText: '暂无导出记录',
          compareIds: [], compareResult: ''
        });
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  },

  onShareAppMessage() {
    analytics.trackShare('gifReport', 'friend');
    return { title: 'GIF 导出报告', path: '/pkgGif/pages/gifReport/gifReport' };
  }
});
