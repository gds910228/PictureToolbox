// pkgGreeting/pages/greeting/greeting.js
// 今日问候：选照片 → 挑样式配祝福 → 生成问候图 → 发亲友/存相册
//
// 定位约定：本页是工具箱上的一个"表达场景"。自带浅色大字皮肤（见 greeting.wxss
// 的 page 级覆盖），不影响全局赛博朋克主题；成品图右下角低调尾签即传播出口，
// 无任何"分享解锁"机制。
//
// 云函数约定（cloudfunctions/aiCaption）：mode='greeting' + greetingCtx，
// featureKey 仍为 'caption'（每日独立限额）；mock=true 表示密钥未配置的示例
// 文案，前端标注「示例」。本地祝福池兜底，无 AI 时功能完整。
//
// 分享落地归因：分享卡 path 带 src=share&tpl=<id>，本页 onLoad 解析上报
// greeting_landing；配合 utils/analytics 的启动 scene 码可看群聊来源占比。

const analytics = require('../../../utils/analytics');
const { guardImage, guardText } = require('../../../utils/content-check');
const { buildGIF } = require('../../utils/gif-encoder');
const {
  TEMPLATES, SLOTS, getOccasion, formatDate, slotIdByHour, getBlessingPool, getUpcomingOccasions
} = require('../../data/templates');

const MAX_PHOTOS = 4;
const CANVAS_W = 1080;
const CANVAS_H = 1440;
const TAIL_SIGN = '图个简单 · 今日问候';
const MAX_TEXT_LEN = 32;

// 动图（GIF）参数：帧用设计坐标的 2/3（720×960）控制体积，100ms/帧无限循环
const ANIM_W = 720;
const ANIM_H = 960;
const ANIM_DELAY_CS = 10;
const BREATH_FRAMES = 12;   // 文字呼吸：一个正弦周期
const TYPEIN_FRAMES = 16;   // 逐字浮现：10 帧打字 + 6 帧停留
const TYPEIN_RAMP = 0.6;    // 时间线前 60% 完成打字，其后整句停留

Page({
  data: {
    step: 1,               // 1 选照片 / 2 样式祝福 / 3 成品
    photos: [],            // [{src}]
    templates: TEMPLATES,
    tplId: TEMPLATES[0].id,
    animKinds: [
      { id: 'none', label: '不动' },
      { id: 'breath', label: '文字呼吸' },
      { id: 'typein', label: '逐字浮现' }
    ],
    animKind: 'none',      // none=静图JPG / breath / typein=GIF
    outIsGif: false,       // 成品是否动图（决定发送/保存分支）
    slots: SLOTS,
    slotId: 'morning',
    pool: [],              // 当前时段祝福池
    poolIdx: 0,            // 池中选中项（-1 = 自定义/AI 文案）
    blessingText: '',
    aiLoading: false,
    aiCaptions: [],        // AI 候选
    aiMock: false,
    occasion: '',          // 今日节日/节气名，空 = 无
    occasionType: '',      // 'festival' | 'term'，顶部氛围带配色用
    slotLabel: '',         // 时段问候词（早安/日安/晚安），页头大字用
    dailyBlessing: '',     // 今日祝福（日期轮换句），页头/祝福卡共用
    upcoming: [],          // 近期节日/节气（天文数据推算，含倒计天数）
    showShareHint: false,  // 分享落地欢迎条
    dateText: '',          // "10月23日"
    outSrc: '',            // 成品临时文件
    coverSrc: '',          // 分享卡片专属 5:4 封面
    exporting: false,
    saving: false
  },

  onLoad(options) {
    const now = new Date();
    const occ = getOccasion(now);
    const slotId = slotIdByHour(now.getHours());

    analytics.track('tool_view', { toolId: 'greeting' });
    // 分享卡落地：src=share 时上报归因（tpl 参数直选模板）
    const fromShare = options && options.src === 'share';
    const tplOk = options && TEMPLATES.some(t => t.id === options.tpl);
    const tplId = tplOk ? options.tpl : TEMPLATES[0].id;
    if (fromShare) {
      analytics.track('greeting_landing', { tpl: tplId });
    }

    // 组合祝福池（节日/节气日场合池前置）+ 每日轮换：按日期取种子，
    // 默认句每天不同、当天内稳定（避免"天天第一句"的重复感）
    const pool = getBlessingPool(slotId, occ);
    const seed = now.getFullYear() * 400 + (now.getMonth() + 1) * 40 + now.getDate();
    this._dailyIdx = seed % pool.length;
    this._textEdited = false;
    let showShareHint = false;
    if (fromShare) {
      try {
        showShareHint = !wx.getStorageSync('greeting_share_hint_closed');
      } catch (e) { showShareHint = true; }
    }
    this.setData({
      slotId,
      slotLabel: (SLOTS.find(x => x.id === slotId) || {}).label || '',
      tplId,
      occasion: occ ? occ.name : '',
      occasionType: occ ? occ.type : '',
      dateText: formatDate(now),
      pool,
      poolIdx: this._dailyIdx,
      blessingText: pool[this._dailyIdx],
      dailyBlessing: pool[this._dailyIdx],
      upcoming: getUpcomingOccasions(now, 3),
      showShareHint
    });
  },

  // ---------- 第 1 步：选照片 ----------

  onChoose() {
    const that = this;
    const remain = MAX_PHOTOS - this.data.photos.length;
    if (remain <= 0) {
      wx.showToast({ title: `最多选 ${MAX_PHOTOS} 张`, icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success(res) {
        that._addPhotos(res.tempFiles.map(f => f.tempFilePath));
      }
    });
  },

  async _addPhotos(paths) {
    // 内容安全：逐张过检，违规图直接丢弃（guardImage 已弹标准化提示）
    const ok = [];
    for (const p of paths) {
      if (await guardImage(p)) ok.push({ src: p });
    }
    if (!ok.length) return;
    const photos = this.data.photos.concat(ok).slice(0, MAX_PHOTOS);
    this.setData({ photos });
  },

  onRemovePhoto(e) {
    const idx = e.currentTarget.dataset.index;
    const photos = this.data.photos.slice();
    photos.splice(idx, 1);
    this.setData({ photos });
  },

  goStep2() {
    if (!this.data.photos.length) {
      wx.showToast({ title: '先选一张照片吧', icon: 'none' });
      return;
    }
    this.setData({ step: 2 });
  },

  // ---------- 第 2 步：样式与祝福语 ----------

  selectTpl(e) {
    this.setData({ tplId: e.currentTarget.dataset.id });
  },

  selectAnim(e) {
    this.setData({ animKind: e.currentTarget.dataset.id });
  },

  /** 今日祝福卡「用这句」：一键把每日轮换句选进祝福语 */
  useDailyBlessing() {
    this._textEdited = true;
    const idx = this.data.pool.indexOf(this.data.dailyBlessing);
    this.setData({ blessingText: this.data.dailyBlessing, poolIdx: idx });
    wx.showToast({ title: '已选好祝福，先选照片吧', icon: 'none' });
  },

  closeShareHint() {
    this.setData({ showShareHint: false });
    try { wx.setStorageSync('greeting_share_hint_closed', 1); } catch (e) { /* 存储异常静默 */ }
  },

  selectSlot(e) {
    const slotId = e.currentTarget.dataset.id;
    if (slotId === this.data.slotId) return;
    const occ = this.data.occasion
      ? { name: this.data.occasion, type: this.data.occasionType }
      : null;
    const pool = getBlessingPool(slotId, occ);
    // 文案未被用户改过时跟随时段切换（落到每日轮换位）；改过则尊重用户文案
    const follow = !this._textEdited;
    const idx = this._dailyIdx % pool.length;
    this.setData({
      slotId,
      pool,
      poolIdx: follow ? idx : this.data.poolIdx,
      blessingText: follow ? pool[idx] : this.data.blessingText
    });
  },

  pickBlessing(e) {
    const idx = e.currentTarget.dataset.index;
    this._textEdited = true;
    this.setData({ poolIdx: idx, blessingText: this.data.pool[idx] });
  },

  /** 随机换一句（排除当前选中的那条） */
  shuffleBlessing() {
    const pool = this.data.pool;
    if (pool.length < 2) return;
    let idx = Math.floor(Math.random() * pool.length);
    if (idx === this.data.poolIdx) idx = (idx + 1) % pool.length;
    this._textEdited = true;
    this.setData({ poolIdx: idx, blessingText: pool[idx] });
  },

  onTextChange(e) {
    this._textEdited = true;
    this.setData({ blessingText: e.detail.value, poolIdx: -1 });
  },

  /**
   * AI 写祝福：上传第一张照片作为画面参考，复用 aiCaption 云函数。
   * 限额用完/服务异常 → 提示回退本地祝福池，不阻断主流程。
   */
  async aiWrite() {
    if (this.data.aiLoading) return;
    const first = this.data.photos[0];
    if (!first) {
      wx.showToast({ title: '先选一张照片吧', icon: 'none' });
      return;
    }
    this.setData({ aiLoading: true });
    wx.showLoading({ title: 'AI 想句子里...', mask: true });
    try {
      const up = await new Promise((resolve, reject) => {
        wx.cloud.uploadFile({
          cloudPath: `aiGreeting/${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`,
          filePath: first.src,
          success: resolve,
          fail: reject
        });
      });
      const slotLabel = (SLOTS.find(s => s.id === this.data.slotId) || {}).label || '';
      const res = await wx.cloud.callFunction({
        name: 'aiCaption',
        data: {
          mode: 'greeting',
          fileID: up.fileID,
          greetingCtx: {
            slot: slotLabel,
            occasion: this.data.occasion,
            date: this.data.dateText
          }
        }
      });
      const r = (res && res.result) || {};
      if (!r.success || !r.captions || !r.captions.length) {
        throw new Error(r.error === 'rate_limit' ? 'limit' : 'service');
      }
      wx.hideLoading();
      analytics.track('greeting_ai', { ok: 1, mock: r.mock ? 1 : 0 });
      this.setData({
        aiCaptions: r.captions.slice(0, 3),
        aiMock: !!r.mock,
        aiLoading: false
      });
    } catch (e) {
      wx.hideLoading();
      analytics.track('greeting_ai', { ok: 0 });
      this.setData({ aiLoading: false });
      const isLimit = e && e.message === 'limit';
      wx.showToast({
        title: isLimit ? '今日 AI 次数用完，先用下面的祝福语吧' : 'AI 暂时没写出来，先用下面的祝福语吧',
        icon: 'none',
        duration: 2500
      });
    }
  },

  aiPick(e) {
    const idx = e.currentTarget.dataset.index;
    const text = this.data.aiCaptions[idx];
    if (!text) return;
    this._textEdited = true;
    this.setData({ blessingText: text, poolIdx: -1 });
  },

  // ---------- 生成与导出 ----------

  async goPreview() {
    const text = (this.data.blessingText || '').trim();
    if (!text) {
      wx.showToast({ title: '先写一句祝福吧', icon: 'none' });
      return;
    }
    // 文案内容安全（AI 生成或手输统一过检，不暴露原因）
    if (!(await guardText(text))) return;

    if (this.data.exporting) return;
    const isAnim = this.data.animKind !== 'none';
    this.setData({ exporting: true });
    wx.showLoading({ title: isAnim ? '动图生成中...' : '生成问候图中...', mask: true });
    try {
      const outSrc = isAnim ? await this._renderAnim() : await this._render();
      const coverSrc = await this._renderCover();
      wx.hideLoading();
      analytics.track('greeting_render', {
        photos: this.data.photos.length,
        tpl: this.data.tplId,
        slot: this.data.slotId,
        anim: this.data.animKind
      });
      this.setData({ outSrc, coverSrc, outIsGif: isAnim, exporting: false, step: 3 });
    } catch (e) {
      wx.hideLoading();
      this.setData({ exporting: false });
      console.error('[greeting] 渲染失败', e);
      wx.showToast({ title: '生成失败，再试一次', icon: 'none' });
    }
  },

  /** 获取画布节点；每次调用按需重设内部分辨率（静图 1080×1440 / 动图帧 720×960） */
  _ensureCanvas(w, h) {
    if (this._canvas) {
      this._canvas.width = w;
      this._canvas.height = h;
      return Promise.resolve(this._canvas);
    }
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().in(this)
        .select('#greetingCanvas')
        .fields({ node: true })
        .exec(res => {
          const node = res && res[0] && res[0].node;
          if (!node) {
            reject(new Error('canvas node not found'));
            return;
          }
          node.width = w;
          node.height = h;
          this._canvas = node;
          resolve(node);
        });
    });
  },

  _loadImage(canvas, src) {
    return new Promise((resolve, reject) => {
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load fail: ' + src));
      img.src = src;
    });
  },

  /** 静图：设计坐标 1080×1440 单帧出 JPG（t=1 全显、无动效） */
  async _render() {
    const canvas = await this._ensureCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const imgs = await this._loadPhotos(canvas);
    this._drawGreeting(ctx, 1, imgs, 'none');
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'jpg',
        quality: 0.92,
        success: res => resolve(res.tempFilePath),
        fail: reject
      });
    });
  },

  /** 动图：帧画布 720×960（设计坐标缩放 2/3）→ 帧循环绘制 → buildGIF → 写用户目录 */
  async _renderAnim() {
    const canvas = await this._ensureCanvas(ANIM_W, ANIM_H);
    const ctx = canvas.getContext('2d');
    if (typeof ctx.getImageData !== 'function') {
      throw new Error('当前微信版本不支持像素读取，请升级微信');
    }
    const s = ANIM_W / CANVAS_W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const imgs = await this._loadPhotos(canvas);

    const kind = this.data.animKind;
    const frameCount = kind === 'typein' ? TYPEIN_FRAMES : BREATH_FRAMES;
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      this._drawGreeting(ctx, i / frameCount, imgs, kind);
      const imgData = ctx.getImageData(0, 0, ANIM_W, ANIM_H);
      frames.push({ width: ANIM_W, height: ANIM_H, rgba: imgData.data, delayCs: ANIM_DELAY_CS });
      // 让出主线程，避免低端机长时间阻塞 UI
      await new Promise(r => setTimeout(r, 0));
    }

    // dither 开启（真机验证后用户拍板：照片渐变色带改善优先于体积）
    const gifBytes = buildGIF(frames, { width: ANIM_W, height: ANIM_H, loop: 0, dither: true });
    const filePath = `${wx.env.USER_DATA_PATH}/greeting_${Date.now()}.gif`;
    await new Promise((resolve, reject) => {
      wx.getFileSystemManager().writeFile({
        filePath,
        data: gifBytes.buffer,
        encoding: 'binary',
        success: resolve,
        fail: reject
      });
    });
    return filePath;
  },

  async _loadPhotos(canvas) {
    return Promise.all(this.data.photos.map(p => this._loadImage(canvas, p.src)));
  },

  /**
   * 分享卡片专属 5:4 封面（1080×864）：小标题 + 照片卡 + 祝福语放大置底。
   * 微信卡片按 5:4 居中裁切，3:4 成品图会被裁掉标题和祝福语，故单独出一张
   * 裁切安全构图；静图/动图统一用此封面（动图不再走默认截图混入界面文字）。
   */
  async _renderCover() {
    const W = 1080;
    const H = 864; // 5:4
    const canvas = await this._ensureCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const tpl = TEMPLATES.find(x => x.id === this.data.tplId) || TEMPLATES[0];
    const headWord = this.data.occasion || this.data.slotLabel;

    // 背景 + 柔光
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, tpl.bg[0]);
    grad.addColorStop(0.55, tpl.bg[1]);
    grad.addColorStop(1, tpl.bg[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-80, -60, 220, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W + 40, H * 0.5, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 标题 + 日期
    ctx.textAlign = 'center';
    ctx.fillStyle = tpl.text;
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText(headWord, W / 2, 108);
    ctx.fillStyle = tpl.sub;
    ctx.font = '32px sans-serif';
    ctx.fillText(this.data.dateText, W / 2, 166);

    // 照片卡
    const frame = { x: 90, y: 210, w: 900, h: 400, r: 32 };
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.10)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    this._pathRound(ctx, frame.x, frame.y, frame.w, frame.h, frame.r);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();
    const inner = { x: frame.x + 24, y: frame.y + 24, w: frame.w - 48, h: frame.h - 48 };
    const cells = this._photoCells(this.data.photos.length, inner);
    const imgs = await this._loadPhotos(canvas);
    for (let i = 0; i < cells.length && i < imgs.length; i++) {
      this._drawCover(ctx, imgs[i], cells[i], 1);
    }

    // 祝福语放大置底
    const lines = this._wrapText(ctx, this.data.blessingText.trim(), inner.w, 46).slice(0, 2);
    ctx.fillStyle = tpl.text;
    ctx.font = 'bold 46px sans-serif';
    lines.forEach((line, i) => {
      ctx.fillText(line, W / 2, 690 + i * 62);
    });

    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'jpg',
        quality: 0.9,
        success: res => resolve(res.tempFilePath),
        fail: reject
      });
    });
  },

  /**
   * 全量绘制（设计坐标系 1080×1440，调用方负责 ctx 缩放）。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} t 时间参数 ∈[0,1]，驱动文字动效；animKind='none' 时全显静帧
   * @param {Image[]} imgs 已加载照片
   * @param {string} animKind 'none' | 'breath' | 'typein'
   */
  _drawGreeting(ctx, t, imgs, animKind) {
    const tpl = TEMPLATES.find(x => x.id === this.data.tplId) || TEMPLATES[0];
    const slotLabel = (SLOTS.find(x => x.id === this.data.slotId) || {}).label || '';
    const occ = this.data.occasion;
    const glow = animKind === 'none' ? 0 : 0.5 + 0.5 * Math.sin(2 * Math.PI * t);

    // 背景：三段渐变 + 两团柔光（动效时轻微呼吸）
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, tpl.bg[0]);
    grad.addColorStop(0.55, tpl.bg[1]);
    grad.addColorStop(1, tpl.bg[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalAlpha = 0.13 + 0.05 * glow;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-80, -60, 260, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(CANVAS_W + 60, CANVAS_H * 0.42, 220, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 顶部标题：有节日/节气时用之，时段问候让位到日期行
    ctx.textAlign = 'center';
    ctx.fillStyle = tpl.text;
    ctx.font = 'bold 104px sans-serif';
    ctx.fillText(occ || slotLabel, CANVAS_W / 2, 200);
    ctx.fillStyle = tpl.sub;
    ctx.font = '38px sans-serif';
    ctx.fillText(occ ? `${this.data.dateText} · ${slotLabel}` : this.data.dateText, CANVAS_W / 2, 264);

    // 照片卡：白底圆角相框，内部按张数分格（各帧相同）
    const frame = { x: 90, y: 330, w: 900, h: 680, r: 36 };
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.10)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    this._pathRound(ctx, frame.x, frame.y, frame.w, frame.h, frame.r);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();

    const inner = { x: frame.x + 24, y: frame.y + 24, w: frame.w - 48, h: frame.h - 48 };
    const cells = this._photoCells(this.data.photos.length, inner);
    // 照片缓推（Ken Burns）：呼吸式推近 1 → 1.05 → 1，与循环无缝衔接（cos 相位保证首尾同帧）
    const photoZoom = animKind === 'none' ? 1 : 1 + 0.05 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
    for (let i = 0; i < cells.length && i < imgs.length; i++) {
      this._drawCover(ctx, imgs[i], cells[i], photoZoom);
    }

    // 祝福语（动效作用区）：呼吸 = 透明度+暖光晕正弦脉动；逐字 = 前 60% 时间线打字，其后停留
    const lines = this._wrapText(ctx, this.data.blessingText.trim(), inner.w, 52).slice(0, 2);
    ctx.fillStyle = tpl.text;
    ctx.font = 'bold 52px sans-serif';
    if (animKind === 'breath') {
      ctx.globalAlpha = 0.78 + 0.22 * glow;
      ctx.shadowColor = tpl.bg[2];
      ctx.shadowBlur = 8 + 16 * glow;
    } else {
      ctx.globalAlpha = 1;
    }
    const totalChars = lines.reduce((n, l) => n + l.length, 0);
    const shown = animKind === 'typein'
      ? Math.round(totalChars * Math.min(t / TYPEIN_RAMP, 1))
      : Infinity;
    let used = 0;
    for (let i = 0; i < lines.length; i++) {
      let text = lines[i];
      if (used + text.length > shown) {
        text = text.slice(0, Math.max(0, shown - used));
      }
      used += lines[i].length;
      ctx.fillText(text, CANVAS_W / 2, 1130 + i * 78);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // 尾签：低调传播出口
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = tpl.sub;
    ctx.font = '26px sans-serif';
    ctx.fillText(TAIL_SIGN, CANVAS_W / 2, CANVAS_H - 56);
    ctx.globalAlpha = 1;
  },

  /** 照片分格：1 张满幅 / 2 张上下 / 3 张一上二下 / 4 张田字 */
  _photoCells(n, inner) {
    const gap = 12;
    const halfW = (inner.w - gap) / 2;
    const halfH = (inner.h - gap) / 2;
    if (n <= 1) return [inner];
    if (n === 2) {
      return [
        { x: inner.x, y: inner.y, w: inner.w, h: halfH },
        { x: inner.x, y: inner.y + halfH + gap, w: inner.w, h: halfH }
      ];
    }
    if (n === 3) {
      return [
        { x: inner.x, y: inner.y, w: inner.w, h: halfH },
        { x: inner.x, y: inner.y + halfH + gap, w: halfW, h: halfH },
        { x: inner.x + halfW + gap, y: inner.y + halfH + gap, w: halfW, h: halfH }
      ];
    }
    return [
      { x: inner.x, y: inner.y, w: halfW, h: halfH },
      { x: inner.x + halfW + gap, y: inner.y, w: halfW, h: halfH },
      { x: inner.x, y: inner.y + halfH + gap, w: halfW, h: halfH },
      { x: inner.x + halfW + gap, y: inner.y + halfH + gap, w: halfW, h: halfH }
    ];
  },

  _pathRound(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  /** 圆角裁切 + cover 适配绘制（Canvas 2D 同步绘制）；zoom>1 时向内缓推（Ken Burns） */
  _drawCover(ctx, img, cell, zoom) {
    ctx.save();
    this._pathRound(ctx, cell.x, cell.y, cell.w, cell.h, 20);
    ctx.clip();
    const iw = img.width || 1;
    const ih = img.height || 1;
    const scale = Math.max(cell.w / iw, cell.h / ih) * (zoom || 1);
    const sw = cell.w / scale;
    const sh = cell.h / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, cell.x, cell.y, cell.w, cell.h);
    ctx.restore();
  },

  /** CJK 逐字折行（空格也按字宽计，不特判换行符） */
  _wrapText(ctx, text, maxWidth, fontPx) {
    ctx.font = `bold ${fontPx}px sans-serif`;
    const lines = [];
    let line = '';
    for (const ch of String(text)) {
      if (ch === '\n' || ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch === '\n' ? '' : ch;
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
    return lines;
  },

  // ---------- 第 3 步：发送 / 保存 ----------

  /** 发送：静图走图片面板直发；动图走 GIF 套件验证过的文件分享（聊天中自动播放） */
  sendToFriend() {
    if (!this.data.outSrc) return;

    if (this.data.outIsGif) {
      if (wx.shareFileMessage) {
        wx.shareFileMessage({
          filePath: this.data.outSrc,
          fileName: '今日问候.gif',
          success: () => {
            analytics.track('greeting_share', { via: 'file' });
          },
          fail: err => {
            if (err && /cancel/i.test(err.errMsg || '')) return;
            wx.showModal({
              title: '转发',
              content: '当前微信版本不支持直接转发动图，已帮你保存到相册，从相册发给亲友即可',
              showCancel: false,
              success: () => this.saveToAlbum()
            });
          }
        });
      } else {
        this.saveToAlbum();
      }
      return;
    }

    if (!wx.canIUse || !wx.canIUse('showShareImageMenu')) {
      this.saveToAlbum();
      return;
    }
    wx.showShareImageMenu({
      path: this.data.outSrc,
      success: () => {
        analytics.track('greeting_share', { via: 'menu' });
      },
      fail: err => {
        if (err && /cancel/i.test(err.errMsg || '')) return;
        wx.showToast({ title: '没发出去，已帮你保存到相册', icon: 'none' });
        this.saveToAlbum();
      }
    });
  },

  saveToAlbum() {
    const that = this;
    if (!this.data.outSrc || this.data.saving) return;
    this.setData({ saving: true });
    wx.saveImageToPhotosAlbum({
      filePath: this.data.outSrc,
      success() {
        that.setData({ saving: false });
        analytics.track('greeting_save', { gif: that.data.outIsGif ? 1 : 0 });
        wx.showToast({
          title: that.data.outIsGif ? '已存相册，发亲友会动哦' : '已保存到相册',
          icon: 'none',
          duration: 2200
        });
      },
      fail(err) {
        that.setData({ saving: false });
        if (err && /auth/i.test(err.errMsg || '')) {
          wx.showModal({
            title: '需要相册权限',
            content: '打开"添加到相册"权限，才能把问候图存下来哦',
            confirmText: '去设置',
            success(r) {
              if (r.confirm) wx.openSetting();
            }
          });
        } else if (!(err && /cancel/i.test(err.errMsg || ''))) {
          wx.showToast({ title: '保存失败，再试一次', icon: 'none' });
        }
      }
    });
  },

  backToEdit() {
    this.setData({ step: 2 });
  },

  restart() {
    this.setData({ step: 1 });
  },

  onShareAppMessage() {
    analytics.trackShare('greeting', 'friend');
    const headWord = this.data.occasion || this.data.slotLabel;
    return {
      title: `我做了张${headWord}问候，你也来一张？`,
      path: `/pkgGreeting/pages/greeting/greeting?src=share&tpl=${this.data.tplId}`,
      // 专属 5:4 封面（标题+照片+祝福语全可见）；未生成过封面时兜底默认截图
      imageUrl: this.data.coverSrc || ''
    };
  },

  onShareTimeline() {
    analytics.trackShare('greeting', 'timeline');
    const headWord = this.data.occasion || this.data.slotLabel;
    return {
      title: `我做了张${headWord}问候，你也来一张？`,
      imageUrl: this.data.coverSrc || ''
    };
  }
});
