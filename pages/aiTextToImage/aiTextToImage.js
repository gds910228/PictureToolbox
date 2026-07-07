// pages/aiTextToImage/aiTextToImage.js
// AI 文生图 —— 腾讯混元 3.0（异步 submit → 轮询 query）+ VLM 辅助写 prompt
//
// 流程：
//   输入 prompt（可点「AI 帮写提示词」让混元 vision 看参考图/模糊需求自动写专业 prompt）
//   → 可选上传 ≤3 张参考图（guardImage）→ 选比例 → guardText(prompt) →
//   callFunction('aiTextToImage', action:'submit') 拿 taskId → 每 3s 轮询 action:'query'
//   → running 显进度 → done 下载结果展示 → 保存/分享/再生成/基于此图再创作
//
// 诚信：demo 态（未配置密钥）submit 不轮询、不伪造图，显示例横幅；失败态显错误+重试；
//      限流/排队/审核/超时各自友好提示。结果图带「AI 生成」水印（合规标识，不引导去除）。

// 画面比例（与云函数 RATIO_RESOLUTION 一致；服务端单点映射到官方尺寸）
const RATIOS = [
  { value: '1:1', label: '1:1', desc: '方形' },
  { value: '3:4', label: '3:4', desc: '竖版' },
  { value: '4:3', label: '4:3', desc: '横版' },
  { value: '16:9', label: '16:9', desc: '宽屏' },
  { value: '9:16', label: '9:16', desc: '竖屏' }
];

const POLL_INTERVAL = 3000; // 轮询间隔 3s
const POLL_MAX = 40;        // 最多轮询 40 次（约 2 分钟）
const MAX_PROMPT = 500;     // 前端输入框上限（云函数侧另有上限校验）

Page({
  data: {
    prompt: '',
    enhancing: false,        // AI 帮写提示词进行中
    enhanceDemo: false,      // 上次帮写返回的是示例（未配置密钥）
    refImages: [],           // [{path, fileID}] 参考图（已上传云存储）
    refPaths: [],            // 参考图本地路径数组（绑定 image-uploader value）
    ratios: RATIOS,
    selectedRatio: '1:1',
    processing: false,
    progress: 0,
    statusText: '',
    taskId: '',
    resultSrc: '',           // 结果图本地临时路径
    resultFileID: '',
    revisedPrompt: '',
    demo: false,             // 示例态（未配置密钥）
    errorMsg: '',
    usedText: '',
    used: 0,
    limit: 20
  },

  onLoad() {
    this._pollTimer = null;
    this._pollCount = 0;
    this.loadQuota();
  },

  onUnload() {
    this._stopPolling();
  },

  onHide() {
    this._stopPolling();
  },

  /**
   * 查询今日已用额度（只读，不消耗）。进页面时调一次，让额度条提前可见。
   */
  async loadQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiTextToImage',
        data: { action: 'quota' }
      });
      const r = (res && res.result) || {};
      console.log('[aiTextToImage] quota 返回', r);
      if (r.success && !r.demo) {
        this.setData({
          usedText: buildUsedText(r.used, r.limit),
          used: r.used || 0,
          limit: r.limit || 20
        });
      }
    } catch (e) {
      console.warn('[aiTextToImage] 查询额度失败', e && (e.errMsg || e.message));
    }
  },

  onPromptInput(e) {
    this.setData({ prompt: e.detail.value || '', enhanceDemo: false });
  },

  /**
   * AI 帮写提示词：把当前想法（+ 可选参考图）交给混元 vision 扩写为专业生图 prompt。
   * 走免费 10 亿 token，不消耗生图额度、不限流。
   */
  async onEnhance() {
    const { prompt, refImages, enhancing } = this.data;
    if (enhancing) return;
    if (!prompt && refImages.length === 0) {
      wx.showToast({ title: '请先输入想法或上传参考图', icon: 'none' });
      return;
    }

    // 想法文本走前端内容安全（违规内部已弹标准提示）
    if (prompt) {
      const { guardText } = require('../../utils/content-check');
      if (!(await guardText(prompt))) return;
    }

    this.setData({ enhancing: true });
    wx.showLoading({ title: 'AI 构思中…', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiTextToImage',
        data: {
          action: 'enhancePrompt',
          idea: prompt,
          referenceFileIDs: refImages[0] ? [refImages[0].fileID] : []
        }
      });
      wx.hideLoading();
      const r = (res && res.result) || {};
      console.log('[aiTextToImage] enhance 返回', r);
      if (r.success && r.prompt) {
        this.setData({ prompt: r.prompt, enhanceDemo: !!r.demo });
        if (r.demo) {
          wx.showToast({ title: '示例提示词（未配置 AI 密钥）', icon: 'none', duration: 2500 });
        } else {
          wx.showToast({ title: '已生成提示词，可编辑', icon: 'none' });
        }
      } else {
        wx.showToast({ title: r.error || 'AI 构思失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[aiTextToImage] 帮写提示词失败', err);
      wx.showToast({ title: 'AI 构思失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ enhancing: false });
    }
  },

  /**
   * 参考图选择回调：每张 guardImage + 上传云存储，剔除违规图，回写 uploader 显示。
   */
  async onImageChange(e) {
    const { paths, count } = e.detail || {};
    if (!count) {
      this.setData({ refImages: [], refPaths: [] });
      return;
    }
    const list = Array.isArray(paths) ? paths : [];
    const existing = new Map(this.data.refImages.map(r => [r.path, r.fileID]));
    const next = [];
    const { guardImage } = require('../../utils/content-check');

    for (const path of list) {
      const fileID = existing.get(path);
      if (fileID) {
        next.push({ path, fileID });
        continue;
      }
      // 新图：前端内容安全 → 上传云存储
      if (!(await guardImage(path))) continue; // 违规已弹标准提示，跳过
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `aiTextToImage/ref_${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg`,
          filePath: path
        });
        next.push({ path, fileID: up.fileID });
      } catch (err) {
        console.error('[aiTextToImage] 参考图上传失败', err);
        wx.showToast({ title: '参考图上传失败', icon: 'none' });
      }
    }

    const refPaths = next.map(r => r.path);
    this.setData({ refImages: next, refPaths });

    // 全部被剔除 / 删除时，强制清空 uploader 显示（value 观察器对空数组不触发清空）
    if (refPaths.length === 0) {
      const uploader = this.selectComponent('#refUploader');
      if (uploader && uploader.getImages && uploader.getImages().length > 0) {
        uploader.clear();
      }
    }
  },

  selectRatio(e) {
    const value = e.currentTarget.dataset.ratio;
    if (!value) return;
    this.setData({ selectedRatio: value, resultSrc: '', resultFileID: '', demo: false, errorMsg: '' });
  },

  /**
   * 开始生成：guardText → submit → 拿 taskId → 轮询
   */
  async startGenerate() {
    const { prompt, refImages, selectedRatio, processing } = this.data;
    if (processing) return;
    if (!prompt || !prompt.trim()) {
      wx.showToast({ title: '请输入提示词', icon: 'none' });
      return;
    }

    // 提示词前端内容安全（违规已弹标准提示）
    const { guardText } = require('../../utils/content-check');
    if (!(await guardText(prompt))) return;

    this._pollCount = 0;
    this.setData({
      processing: true,
      progress: 8,
      statusText: '正在提交生成任务…',
      errorMsg: '',
      resultSrc: '',
      resultFileID: '',
      revisedPrompt: '',
      demo: false
    });

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiTextToImage',
        data: {
          action: 'submit',
          prompt,
          referenceFileIDs: refImages.map(r => r.fileID),
          ratio: selectedRatio
        }
      });
      const r = (res && res.result) || {};
      console.log('[aiTextToImage] submit 返回', r);

      // 示例态：未配置密钥，不轮询、不伪造图
      if (r.success && r.demo) {
        this.setData({
          processing: false,
          progress: 0,
          statusText: '',
          demo: true,
          usedText: buildUsedText(r.used, r.limit, this.data.usedText)
        });
        return;
      }

      // 限流
      if (!r.success && r.error === 'rate_limit') {
        this.setData({
          processing: false,
          progress: 0,
          statusText: '',
          errorMsg: `今日文生图额度已用完（${r.used || 0}/${r.limit || 20}），请明天再试`,
          usedText: buildUsedText(r.used, r.limit)
        });
        return;
      }

      if (!r.success || !r.taskId) {
        this.setData({
          processing: false,
          progress: 0,
          statusText: '',
          errorMsg: friendlyError(r)
        });
        return;
      }

      // 提交成功 → 轮询；额度条按 submit 计数刷新
      this.setData({
        taskId: r.taskId,
        usedText: buildUsedText(r.used, r.limit, this.data.usedText)
      });
      this._startPolling(r.taskId);
    } catch (err) {
      console.error('[aiTextToImage] 提交失败', err);
      this.setData({
        processing: false,
        progress: 0,
        statusText: '',
        errorMsg: '提交失败，请稍后重试'
      });
    }
  },

  /**
   * 轮询查询任务状态
   */
  _startPolling(taskId) {
    this.setData({ statusText: 'AI 生成中，请稍候…', progress: 20 });

    const tick = async () => {
      this._pollCount += 1;
      if (this._pollCount > POLL_MAX) {
        this._stopPolling();
        this.setData({
          processing: false,
          progress: 0,
          errorMsg: 'AI 生成超时，请重试'
        });
        return;
      }

      this.setData({
        progress: Math.min(90, 25 + this._pollCount * 5),
        statusText: `AI 生成中…（第 ${this._pollCount} 次）`
      });

      let res;
      try {
        res = await wx.cloud.callFunction({
          name: 'aiTextToImage',
          data: { action: 'query', taskId }
        });
      } catch (e) {
        console.warn('[aiTextToImage] 查询失败，稍后重试', e);
        this._pollTimer = setTimeout(tick, POLL_INTERVAL);
        return;
      }

      const r = (res && res.result) || {};
      // 完成：下载结果 → 展示
      if (r.success && r.status === 'done' && r.fileID) {
        this._stopPolling();
        try {
          wx.showLoading({ title: '加载结果…', mask: true });
          const dl = await wx.cloud.downloadFile({ fileID: r.fileID });
          wx.hideLoading();
          this.setData({
            resultSrc: dl.tempFilePath,
            resultFileID: r.fileID,
            revisedPrompt: r.revisedPrompt || '',
            progress: 100,
            processing: false,
            statusText: ''
          });
        } catch (e) {
          wx.hideLoading();
          console.error('[aiTextToImage] 下载结果失败', e);
          this.setData({ processing: false, progress: 0, errorMsg: '结果加载失败，请重试' });
        }
        return;
      }

      // 失败
      if (!r.success || r.status === 'fail') {
        this._stopPolling();
        this.setData({
          processing: false,
          progress: 0,
          errorMsg: friendlyError(r)
        });
        return;
      }

      // running —— 继续轮询
      this._pollTimer = setTimeout(tick, POLL_INTERVAL);
    };

    this._pollTimer = setTimeout(tick, POLL_INTERVAL);
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  previewResult() {
    if (!this.data.resultSrc) return;
    wx.previewImage({ current: this.data.resultSrc, urls: [this.data.resultSrc] });
  },

  saveResult() {
    const src = this.data.resultSrc;
    if (!src) {
      wx.showToast({ title: '请先生成图片', icon: 'none' });
      return;
    }
    wx.getSetting({
      success: (res) => {
        if (!res.authSetting['scope.writePhotosAlbum']) {
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: () => this._saveToAlbum(src),
            fail: () => wx.showModal({
              title: '提示',
              content: '需要您授权保存图片到相册',
              showCancel: false
            })
          });
        } else {
          this._saveToAlbum(src);
        }
      }
    });
  },

  _saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err) => {
        console.error('[aiTextToImage] 保存失败', err);
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({ title: '提示', content: '需要您授权保存图片到相册', showCancel: false });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  },

  /**
   * 再生成：清结果回输入态（同 prompt，混元随机种子→不同结果）
   */
  regenerate() {
    this._stopPolling();
    this.setData({
      resultSrc: '',
      resultFileID: '',
      revisedPrompt: '',
      errorMsg: '',
      demo: false,
      progress: 0,
      statusText: ''
    });
  },

  /**
   * 基于此图再创作：把生成结果作参考图，回输入态调整 prompt 再生成
   */
  recreate() {
    const { resultSrc, resultFileID } = this.data;
    if (!resultSrc || !resultFileID) return;
    this._stopPolling();
    const refImages = [{ path: resultSrc, fileID: resultFileID }];
    this.setData({
      refImages,
      refPaths: [resultSrc],
      resultSrc: '',
      resultFileID: '',
      revisedPrompt: '',
      errorMsg: '',
      demo: false,
      progress: 0,
      statusText: ''
    });
    wx.showToast({ title: '已把结果设为参考图，可改提示词再生成', icon: 'none', duration: 2500 });
  },

  resetAll() {
    this._stopPolling();
    this.setData({
      prompt: '',
      enhancing: false,
      enhanceDemo: false,
      refImages: [],
      refPaths: [],
      selectedRatio: '1:1',
      processing: false,
      progress: 0,
      statusText: '',
      taskId: '',
      resultSrc: '',
      resultFileID: '',
      revisedPrompt: '',
      demo: false,
      errorMsg: ''
    });
    const uploader = this.selectComponent('#refUploader');
    if (uploader && uploader.clear) uploader.clear();
  },

  onImageLoad() {},

  onImageError(e) {
    console.error('[aiTextToImage] 结果图加载失败', e.detail);
    wx.showToast({ title: '图片加载失败', icon: 'none' });
  },

  onShareAppMessage() {
    return {
      title: '用腾讯混元 3.0 一键文生图，AI 帮你写提示词',
      path: '/pages/aiTextToImage/aiTextToImage',
      imageUrl: this.data.resultSrc || ''
    };
  }
});

/**
 * 构造今日额度文案。仅密钥可用时云函数才返回 used/limit；缺失则回退旧文案（不倒退展示）。
 */
function buildUsedText(used, limit, fallback) {
  const u = Number(used);
  const l = Number(limit);
  if (!isFinite(u) || !isFinite(l) || l <= 0) return fallback || '';
  return `今日已用 ${u}/${l} 次`;
}

/**
 * 把云函数返回的失败结果映射为面向用户的文案
 */
function friendlyError(r) {
  if (!r) return '生成失败，请重试';
  if (r.error === 'rate_limit') {
    return `今日文生图额度已用完（${r.used || 0}/${r.limit || 20}），请明天再试`;
  }
  return r.error || '生成失败，请重试';
}
