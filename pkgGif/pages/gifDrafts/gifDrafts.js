// pages/gifDrafts/gifDrafts.js
// 编辑草稿管理：列表/恢复/删除/重命名/清理/存储统计。
const analytics = require('../../../utils/analytics');

const DRAFT_KEY = 'gifEditor_draft';
const DRAFT_SOURCE = 'gifEditor_source.gif';

Page({
  data: {
    drafts: [],
    storageUsed: '0 KB',
    storageLimit: '10 MB',
    totalSize: 0
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'gifDrafts' });
    this._loadDrafts();
  },

  onShow() {
    this._loadDrafts();
  },

  _loadDrafts() {
    const drafts = [];
    let totalSize = 0;

    // 主草稿
    try {
      const draft = wx.getStorageSync(DRAFT_KEY);
      if (draft && draft.savedAt) {
        const size = this._estimateDraftSize(draft);
        totalSize += size;
        drafts.push({
          id: 'main',
          name: draft.fileName || '未命名草稿',
          savedAt: this._formatTime(draft.savedAt),
          timestamp: draft.savedAt,
          opCount: this._countOps(draft),
          size: this._formatSize(size),
          canRestore: true,
          speed: draft.speed || 1,
          hasTexts: (draft.texts || []).length,
          hasCrop: !!draft.crop,
          hasErase: (draft.eraseStrokes || []).length
        });
      }
    } catch (e) { /* ignore */ }

    // 检查源文件是否存在
    const fs = wx.getFileSystemManager();
    const sourcePath = `${wx.env.USER_DATA_PATH}/${DRAFT_SOURCE}`;
    try {
      fs.accessSync(sourcePath);
      const stat = fs.statSync(sourcePath);
      totalSize += stat.size;
    } catch (e) {
      // 源文件不存在，标记草稿不可恢复
      if (drafts.length > 0) drafts[0].canRestore = false;
    }

    // Storage 总量
    try {
      const info = wx.getStorageInfoSync();
      totalSize += info.currentSize * 1024; // KB → bytes
    } catch (e) { /* ignore */ }

    this.setData({
      drafts,
      totalSize,
      storageUsed: this._formatSize(totalSize)
    });
  },

  _countOps(draft) {
    let count = 0;
    if (draft.speed && draft.speed !== 1) count++;
    if (draft.texts && draft.texts.length) count += draft.texts.length;
    if (draft.crop) count++;
    if (draft.eraseStrokes && draft.eraseStrokes.length) count += draft.eraseStrokes.length;
    if (draft.useAdaptive) count++;
    return count;
  },

  _estimateDraftSize(draft) {
    try {
      return JSON.stringify(draft).length;
    } catch (e) {
      return 1024;
    }
  },

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  },

  _formatTime(ts) {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  restoreDraft(e) {
    const id = e.currentTarget.dataset.id;
    if (id !== 'main') return;
    const draft = this.data.drafts.find(d => d.id === id);
    if (!draft || !draft.canRestore) {
      wx.showToast({ title: '源文件已失效', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pkgGif/pages/gifEditor/gifEditor?restoreDraft=1' });
  },

  deleteDraft(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除草稿',
      content: '确定删除此草稿？源文件和编辑记录将被清除。',
      success: (r) => {
        if (!r.confirm) return;
        try { wx.removeStorageSync(DRAFT_KEY); } catch (e) { /* ignore */ }
        try {
          const fs = wx.getFileSystemManager();
          fs.unlinkSync(`${wx.env.USER_DATA_PATH}/${DRAFT_SOURCE}`);
        } catch (e) { /* ignore */ }
        this._loadDrafts();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  renameDraft(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '重命名草稿',
      editable: true,
      placeholderText: '输入草稿名称',
      success: (r) => {
        if (!r.confirm || !r.content) return;
        try {
          const draft = wx.getStorageSync(DRAFT_KEY);
          if (draft) {
            draft.fileName = r.content;
            wx.setStorageSync(DRAFT_KEY, draft);
            this._loadDrafts();
          }
        } catch (e) { /* ignore */ }
      }
    });
  },

  clearAll() {
    if (this.data.drafts.length === 0) {
      wx.showToast({ title: '暂无草稿', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '清理全部',
      content: '将删除所有草稿和源文件，释放存储空间。',
      success: (r) => {
        if (!r.confirm) return;
        try { wx.removeStorageSync(DRAFT_KEY); } catch (e) { /* ignore */ }
        try {
          const fs = wx.getFileSystemManager();
          fs.unlinkSync(`${wx.env.USER_DATA_PATH}/${DRAFT_SOURCE}`);
        } catch (e) { /* ignore */ }
        this._loadDrafts();
        wx.showToast({ title: '已清理', icon: 'success' });
      }
    });
  },

  freeSpace() {
    wx.showModal({
      title: '释放空间',
      content: '将清理临时文件和缓存（不影响已保存的 GIF）。',
      success: (r) => {
        if (!r.confirm) return;
        // 清理缩略图临时文件
        try {
          const fs = wx.getFileSystemManager();
          const files = fs.readdirSync(wx.env.USER_DATA_PATH);
          let cleaned = 0;
          for (const f of files) {
            if (f.indexOf('thumb_') === 0 || f.indexOf('tmp_') === 0) {
              try { fs.unlinkSync(`${wx.env.USER_DATA_PATH}/${f}`); cleaned++; } catch (e) { /* ignore */ }
            }
          }
          wx.showToast({ title: `已清理 ${cleaned} 个文件`, icon: 'success' });
          this._loadDrafts();
        } catch (e) {
          wx.showToast({ title: '清理完成', icon: 'success' });
        }
      }
    });
  }
});
