// pages/aiChat/aiChat.js
// AI图片问答页面：上传图片 + 多轮自由提问 + 打字机伪流式
// 仅页内内存：返回/关闭即清空，不持久化（工具类小程序轻量定位）
// 仅首轮带图：history 为空时带 fileID，后续轮只发文本历史

const MAX_ROUNDS = 10;

const analytics = require('../../utils/analytics');

Page({
  data: {
    imageSrc: '',
    fileID: '',
    messages: [],     // {role:'user'|'assistant', content, pending?, error?, demo?}
    input: '',
    sending: false,
    reachedCap: false,
    scrollAnchor: '',
    presets: [
      '描述这张图',
      '这是什么？',
      '能用来当头像吗？',
      '帮我配一段朋友圈文案'
    ]
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'aiChat' });
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  // ---------- 图片 ----------
  chooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(res) {
        const p = res.tempFiles[0].tempFilePath;
        // 换图即重置会话：历史与新图不符，避免上下文错乱
        that.setData({
          imageSrc: p,
          fileID: '',
          messages: [],
          input: '',
          reachedCap: false,
          sending: false
        });
        that.uploadImage(p);
      }
    });
  },

  async uploadImage(filePath) {
    const { guardImage } = require('../../utils/content-check');
    if (!(await guardImage(filePath))) {
      this.setData({ imageSrc: '', fileID: '' });
      return;
    }
    wx.showLoading({ title: '上传中...', mask: true });
    const cloudPath = `aiChat/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        this.setData({ fileID: res.fileID });
        wx.hideLoading();
      },
      fail: (err) => {
        console.error('上传失败', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
        this.setData({ imageSrc: '', fileID: '' });
      }
    });
  },

  removeImage() {
    this.setData({
      imageSrc: '',
      fileID: '',
      messages: [],
      input: '',
      reachedCap: false,
      sending: false
    });
  },

  // ---------- 发送 ----------
  onPreset(e) {
    const q = e.currentTarget.dataset.q;
    this.setData({ input: q }, () => this.send());
  },

  async send() {
    const q = String(this.data.input || '').trim();
    if (!q) return;
    if (this.data.sending) return;
    if (!this.data.fileID) {
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      return;
    }
    if (this.data.reachedCap) {
      wx.showToast({ title: '已达本轮上限，请清空会话', icon: 'none' });
      return;
    }

    // 文本内容安全（违规则已弹标准化提示）
    const { guardText } = require('../../utils/content-check');
    if (!(await guardText(q))) return;

    // 历史（不含当前问题），供云函数重建多轮
    const history = this.data.messages
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role, content: m.content }));

    const isFirstRound = history.length === 0;
    const messages = this.data.messages.concat([
      { role: 'user', content: q },
      { role: 'assistant', content: '', pending: true }
    ]);

    const userCount = messages.filter((m) => m.role === 'user').length;
    const reachedCap = userCount >= MAX_ROUNDS;

    this.setData({ messages, input: '', sending: true, reachedCap });
    this._scrollToBottom();

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiImageChat',
        data: {
          fileID: isFirstRound ? this.data.fileID : '',
          question: q,
          history
        },
        timeout: 30000
      });
      const r = (res && res.result) || {};
      const lastIdx = this.data.messages.length - 1;
      if (r.success) {
        this._typewrite(lastIdx, r.answer || '', !!r.demo);
      } else {
        this._failLast(lastIdx, r.error || '生成失败');
      }
    } catch (err) {
      console.error('调用问答云函数失败', err);
      const lastIdx = this.data.messages.length - 1;
      this._failLast(lastIdx, '网络异常，请稍后重试');
    } finally {
      this.setData({ sending: false });
    }
  },

  // 打字机伪流式
  _typewrite(idx, full, demo) {
    this.setData({
      [`messages[${idx}].pending`]: false,
      [`messages[${idx}].demo`]: !!demo
    });
    let i = 0;
    const step = Math.max(1, Math.ceil(full.length / 80)); // 长文快打
    const tick = () => {
      i += step;
      const slice = full.slice(0, i);
      this.setData({ [`messages[${idx}].content`]: slice });
      if (i < full.length) {
        this._timer = setTimeout(tick, 28);
      } else {
        this.setData({ [`messages[${idx}].content`]: full });
        this._scrollToBottom();
      }
    };
    tick();
  },

  _failLast(idx, msg) {
    if (idx < 0) return;
    this.setData({
      [`messages[${idx}].pending`]: false,
      [`messages[${idx}].error`]: true,
      [`messages[${idx}].content`]: msg
    });
  },

  _scrollToBottom() {
    // scroll-into-view 同值不会重触发，先清空再设回
    this.setData({ scrollAnchor: '' });
    setTimeout(() => this.setData({ scrollAnchor: 'bottom' }), 50);
  },

  // ---------- 操作 ----------
  onCopy(e) {
    const idx = e.currentTarget.dataset.idx;
    const m = this.data.messages[idx];
    if (m && m.content) {
      wx.setClipboardData({
        data: m.content,
        success() {
          wx.showToast({ title: '已复制', icon: 'success' });
        }
      });
    }
  },

  // 重新生成最后一条 AI 回答：回退到最后一个 user 之前，重发该问题
  regenerate() {
    if (this.data.sending) return;
    const msgs = this.data.messages.slice();
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    const lastQ = msgs[lastUserIdx].content;
    const kept = msgs.slice(0, lastUserIdx);
    this.setData({ messages: kept, reachedCap: false }, () => {
      this.setData({ input: lastQ }, () => this.send());
    });
  },

  clearChat() {
    if (!this.data.messages.length) return;
    wx.showModal({
      title: '清空会话',
      content: '将清除当前对话，图片保留，可重新提问。确认？',
      confirmColor: '#FF0080',
      success: (r) => {
        if (r.confirm) {
          this.setData({
            messages: [],
            input: '',
            reachedCap: false,
            sending: false,
            scrollAnchor: ''
          });
        }
      }
    });
  },

  onUnload() {
    if (this._timer) clearTimeout(this._timer);
  },

  onShareAppMessage() {
    analytics.trackShare('aiChat', 'friend');
    return {
      title: 'AI 图片问答：上传图片自由提问，多轮追问',
      path: '/pages/aiChat/aiChat'
    };
  },

  onShareTimeline() {
    analytics.trackShare('aiChat', 'timeline');
    return { title: '拍张照问 AI，看图问答多轮追问' };
  }
});
