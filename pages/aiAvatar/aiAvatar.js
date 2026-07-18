// pages/aiAvatar/aiAvatar.js
// AI 百变头像 —— 腾讯混元 GenerateAvatar（同步 10–30s）
//
// 流程：人像 / 萌宠双模式 → 选图 → guardImage → 上传云存储拿 fileID →
//      （人像）15 风格网格选择 + 🎲 随机盲盒 → callFunction('aiAvatar') →
//      结果展示（方形头像框）→ 保存 / 分享 / 再生成 / 换风格 / 对比查看
// 诚信：demo 态（未配置密钥）结果=原图 + 示例角标；失败态显错误+引导+重试；
//      限流 / 排队 / 违规 / 人像质检 各自友好提示。
// 流量：onShareAppMessage + onShareTimeline 双分享入口；结果图即分享图。

const compareHelper = require('../../utils/compare-helper');
const analytics = require('../../utils/analytics');

// 官方「百变头像风格列表」15 个风格（仅人像模式生效；编号不臆造）。
// 来源：https://cloud.tencent.com/document/product/1668/107741
// emoji + tag 用于网格可视化与「热门」引流标注（tag 为运营标注，非 API 字段）。
// desc 为风格主题的轻量文字预览（依风格名释义，非结果保证），选中时展示，帮用户挑选。
const HUMAN_STYLES = [
  { code: 'flower',    name: '复古繁花', emoji: '🌸',  tag: '',     desc: '复古花卉环绕，温婉典雅' },
  { code: 'babi',      name: '芭比',     emoji: '💖',  tag: '热门', desc: '粉嫩梦幻，芭比娃娃风' },
  { code: 'commerce',  name: '白领精英', emoji: '💼',  tag: '',     desc: '商务正装，干练职场' },
  { code: 'wedding',   name: '婚纱日记', emoji: '👰',  tag: '热门', desc: '婚纱礼服，浪漫纯洁' },
  { code: 'gufeng',    name: '醉梦红尘', emoji: '🏮',  tag: '古风', desc: '古风汉服，仙气飘逸' },
  { code: 'coin',      name: '暴富',     emoji: '💰',  tag: '热门', desc: '金币钞票背景，喜庆暴富' },
  { code: 'water',     name: '夏日水镜', emoji: '💧',  tag: '',     desc: '水波镜面，清凉夏日' },
  { code: 'retro',     name: '复古港漫', emoji: '🎞️', tag: '热门', desc: '港式漫画风，复古摩登' },
  { code: 'amusement', name: '游乐场',   emoji: '🎡',  tag: '',     desc: '游乐场背景，欢快童趣' },
  { code: 'astronaut', name: '宇航员',   emoji: '🚀',  tag: '',     desc: '太空宇航服，科幻未来' },
  { code: 'cartoon',   name: '休闲时刻', emoji: '☕',  tag: '',     desc: '休闲日常，轻松惬意' },
  { code: 'star',      name: '回到童年', emoji: '🌟',  tag: '',     desc: '童真星空，可爱梦幻' },
  { code: 'dopamine',  name: '多巴胺',   emoji: '🍬',  tag: '热门', desc: '高饱和撞色，活力多巴胺' },
  { code: 'comic',     name: '心动初夏', emoji: '💗',  tag: '',     desc: '夏日心动，清新漫画' },
  { code: 'beach',     name: '夏日沙滩', emoji: '🏖️', tag: '',     desc: '阳光沙滩，度假风情' }
];

// 人像模式分辨率下限：Filter=1 会拦截单边 <500，前端预检对齐此阈值，避免浪费一次失败额度。
const HUMAN_MIN_SIDE = 500;

Page({
  data: {
    mode: 'human',          // 'human' | 'pet'
    imageSrc: '',           // 原图本地路径
    fileID: '',             // 原图云存储 fileID
    styles: HUMAN_STYLES,   // 人像风格列表（pet 模式隐藏）
    selectedStyle: 'flower',
    selectedStyleDesc: styleDescOf('flower'),  // 选中风格的主题文字预览
    resultSrc: '',          // 结果图本地临时路径
    resultFileID: '',
    resultStyleCode: '',    // 本次结果所用风格
    resultStyleName: '',    // 本次结果风格名（结果区标题）
    demo: false,            // 示例态（未配置密钥，结果=原图）
    loading: false,
    errorMsg: '',
    errorHint: '',          // 错误引导（如人像质检：建议重新上传清晰正面单人照）
    usedText: ''            // 今日额度文案 "今日已用 X/20"
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'aiAvatar' });
    this.loadQuota();
  },

  /**
   * 查询今日已用额度（只读，不消耗）。进页面时调一次，让额度条提前可见。
   * demo 态（未配置密钥）不展示额度条。
   */
  async loadQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiAvatar',
        data: { action: 'quota' }
      });
      const r = (res && res.result) || {};
      console.log('[aiAvatar] quota 返回', r);
      if (r.success && !r.demo) {
        this.setData({ usedText: buildUsedText(r.used, r.limit) });
      }
    } catch (e) {
      // 查询失败不影响主流程，静默（额度条暂不展示，生成后仍会刷新）
      console.warn('[aiAvatar] 查询额度失败', e && (e.errMsg || e.message));
    }
  },

  /**
   * 模式切换：人像 / 萌宠。保留已上传照片，仅清空结果。
   */
  onModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.mode) return;
    this.setData({
      mode,
      resultSrc: '', resultFileID: '',
      resultStyleCode: '', resultStyleName: '',
      demo: false, errorMsg: '', errorHint: ''
    });
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
      resultSrc: '', resultFileID: '',
      resultStyleCode: '', resultStyleName: '',
      demo: false, errorMsg: '', errorHint: ''
    });
    await this.uploadImage(filePath);
  },

  /**
   * 内容安全 + 分辨率预检 + 上传云存储
   */
  async uploadImage(filePath) {
    const { guardImage } = require('../../utils/content-check');
    if (!(await guardImage(filePath))) {
      // 内容安全拦截，清空已展示的图
      this._clearSelectedImage();
      return;
    }

    // 人像模式分辨率预检：Filter=1 会拦截单边 <500，提前提示省一次失败额度。
    // （阈值由官方 Filter 文档背书，不会误拦可成功生成的图；pet 模式无 Filter，交由服务端友好报错）
    if (this.data.mode === 'human') {
      const info = await this.getImageInfo(filePath);
      if (info.width && info.height && Math.min(info.width, info.height) < HUMAN_MIN_SIDE) {
        wx.showModal({
          title: '照片分辨率过低',
          content: `建议上传单边 ${HUMAN_MIN_SIDE} 像素以上的清晰正面照，避免生成失败。`,
          showCancel: false,
          confirmText: '重新选择'
        });
        this._clearSelectedImage();
        return;
      }
    }

    wx.showLoading({ title: '上传中...', mask: true });
    try {
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `aiAvatar/src_${Date.now()}.jpg`,
        filePath: filePath
      });
      this.setData({ fileID: uploadRes.fileID });
    } catch (err) {
      console.error('[aiAvatar] 上传失败', err);
      wx.showToast({ title: '上传失败，请重试', icon: 'none' });
      this.setData({ imageSrc: '', fileID: '' });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 选择风格：清空旧结果，保留照片
   */
  selectStyle(e) {
    const code = e.currentTarget.dataset.code;
    if (!code || code === this.data.selectedStyle) return;
    this.setData({
      selectedStyle: code,
      selectedStyleDesc: styleDescOf(code),
      resultSrc: '', resultFileID: '',
      resultStyleCode: '', resultStyleName: '',
      demo: false, errorMsg: '', errorHint: ''
    });
  },

  /**
   * 🎲 随机风格（盲盒）：随机选一个风格；若已上传照片则自动生成。
   */
  randomStyle() {
    if (this.data.loading) return;
    const pool = HUMAN_STYLES;
    let idx = Math.floor(Math.random() * pool.length);
    if (pool[idx].code === this.data.selectedStyle && pool.length > 1) {
      idx = (idx + 1) % pool.length;
    }
    const pick = pool[idx].code;
    this.setData({
      selectedStyle: pick,
      selectedStyleDesc: styleDescOf(pick),
      resultSrc: '', resultFileID: '',
      resultStyleCode: '', resultStyleName: '',
      demo: false, errorMsg: '', errorHint: ''
    });
    if (this.data.fileID) {
      this.startGenerate(pick);
    } else {
      wx.showToast({ title: `已选「${pool[idx].name}」`, icon: 'none' });
    }
  },

  /**
   * 调云函数生成头像
   * @param {string} [overrideStyle] 随机盲盒 / 再生成时传入，覆盖 selectedStyle
   */
  async startGenerate(overrideStyle) {
    const { fileID, mode, loading } = this.data;
    if (loading) return;
    if (!fileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    // bindtap 会把事件对象作为首个参数传入；仅接受有效的风格编号字符串，
    // 否则回退到当前已选风格（随机盲盒 / 再生成会显式传字符串 code）。
    const override = (typeof overrideStyle === 'string') ? overrideStyle : '';
    const styleToUse = override || this.data.selectedStyle;
    if (mode === 'human' && !styleToUse) {
      wx.showToast({ title: '请选择风格', icon: 'none' });
      return;
    }

    this.setData({ loading: true, errorMsg: '', errorHint: '' });
    wx.showLoading({ title: 'AI 生成中…', mask: true });

    try {
      const data = { fileID, type: mode };
      if (mode === 'human') data.style = styleToUse;

      const res = await wx.cloud.callFunction({ name: 'aiAvatar', data });
      wx.hideLoading();

      const r = (res && res.result) || {};
      console.log('[aiAvatar] generate 返回', r);
      if (r.success) {
        const styleName = mode === 'human'
          ? (HUMAN_STYLES.find(s => s.code === styleToUse) || {}).name || '风格头像'
          : '萌宠贴纸';
        if (r.demo) {
          // 示例态：未配置密钥，结果=原图
          this.setData({
            resultSrc: this.data.imageSrc,
            resultFileID: fileID,
            resultStyleCode: styleToUse,
            resultStyleName: styleName,
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
          resultStyleCode: styleToUse,
          resultStyleName: styleName,
          demo: false,
          loading: false,
          usedText: buildUsedText(r.used, r.limit)
        });
        analytics.track('tool_complete', { toolId: 'aiAvatar' });
      } else {
        this.setData({
          loading: false,
          errorMsg: this.friendlyError(r),
          errorHint: r.hint || '',
          usedText: buildUsedText(r.used, r.limit)
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[aiAvatar] 调用失败', err);
      this.setData({ loading: false, errorMsg: '头像生成失败，请稍后重试' });
    }
  },

  /**
   * 把云函数返回的失败结果映射为面向用户的文案
   */
  friendlyError(r) {
    if (r.error === 'rate_limit') {
      return `今日头像额度已用完（${r.used || 0}/${r.limit || 20}），请明天再试`;
    }
    return r.error || '头像生成失败，请重试';
  },

  /**
   * 再生成：同照片同风格再跑一次（GenerateAvatar 无 seed，每次结果不同）
   */
  regenerate() {
    if (this.data.mode === 'human') {
      this.startGenerate(this.data.resultStyleCode || this.data.selectedStyle);
    } else {
      this.startGenerate();
    }
  },

  /**
   * 换风格：清空结果，回到选风格 + 生成态（保留照片）
   */
  changeStyle() {
    this.setData({
      resultSrc: '', resultFileID: '',
      resultStyleCode: '', resultStyleName: '',
      demo: false, errorMsg: '', errorHint: ''
    });
  },

  previewResultImage() {
    if (!this.data.resultSrc) {
      wx.showToast({ title: '暂无结果图片', icon: 'none' });
      return;
    }
    wx.previewImage({
      current: this.data.resultSrc,
      urls: [this.data.imageSrc, this.data.resultSrc].filter(Boolean)
    });
  },

  /**
   * 对比查看（跳转 compare 滑动对比页：原图 vs 风格化头像）
   */
  onCompare() {
    if (!this.data.imageSrc || !this.data.resultSrc) {
      wx.showToast({ title: '请先完成生成', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.resultSrc, {
      title: '头像对比',
      processedLabel: this.data.resultStyleName || '风格化'
    });
  },

  saveResult() {
    if (!this.data.resultSrc) {
      wx.showToast({ title: '请先完成生成', icon: 'none' });
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
        console.error('[aiAvatar] 保存失败', err);
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({ title: '提示', content: '需要您授权保存图片到相册', showCancel: false });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  },

  resetAll() {
    this.setData({
      imageSrc: '', fileID: '',
      resultSrc: '', resultFileID: '',
      resultStyleCode: '', resultStyleName: '',
      demo: false, errorMsg: '', errorHint: '',
      selectedStyle: 'flower', selectedStyleDesc: styleDescOf('flower'), usedText: ''
    });
  },

  /**
   * 清空已选图片（内容安全 / 分辨率预检拦截时调用）：清 data + 同步 uploader 组件。
   */
  _clearSelectedImage() {
    this.setData({ imageSrc: '', fileID: '' });
    const uploader = this.selectComponent('#mainUploader');
    if (uploader && uploader.clear) uploader.clear();
  },

  /**
   * 读取图片宽高（分辨率预检用）；失败返回 {0,0}，交由服务端兜底。
   */
  getImageInfo(filePath) {
    return new Promise((resolve) => {
      wx.getImageInfo({
        src: filePath,
        success: (res) => resolve({ width: res.width, height: res.height }),
        fail: () => resolve({ width: 0, height: 0 })
      });
    });
  },

  onImageLoad() {},

  onImageError(e) {
    console.error('[aiAvatar] 结果图加载失败', e.detail);
    wx.showToast({ title: '图片加载失败', icon: 'none', duration: 2000 });
  },

  onShareAppMessage() {
    analytics.trackShare('aiAvatar', 'friend');
    return {
      title: '用 AI 一键生成多风格头像：复古繁花 / 暴富 / 多巴胺…',
      path: '/pages/aiAvatar/aiAvatar',
      imageUrl: this.data.resultSrc || this.data.imageSrc || ''
    };
  },

  onShareTimeline() {
    analytics.trackShare('aiAvatar', 'timeline');
    return {
      title: '用 AI 一键生成多风格头像：复古繁花 / 暴富 / 多巴胺…',
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
 * 取风格主题描述（选中时展示的文字预览）。未知 code 返回空串。
 */
function styleDescOf(code) {
  const s = HUMAN_STYLES.find((x) => x.code === code);
  return s && s.desc ? s.desc : '';
}
