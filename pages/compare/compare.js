// pages/compare/compare.js - 图片对比查看器
const compareHelper = require('../../utils/compare-helper');
const imageProcess = require('../../utils/image-process');

const MAX_SCALE = 4;
const MIN_SCALE = 1;

Page({
  data: {
    title: '对比查看',
    mode: 'slide',            // slide | toggle
    showInfo: false,
    originalLabel: '原图',
    processedLabel: '处理后',
    originalLocalPath: '',
    processedLocalPath: '',
    originalSizeText: '',
    processedSizeText: '',
    loading: true,
    loadError: '',
    showOriginal: false,      // 切换模式：当前是否显示原图
    zoomed: false             // 滑动模式：是否处于放大状态
  },

  onLoad() {
    const pending = compareHelper.consumePendingCompare();
    if (!pending || !pending.originalPath || !pending.processedPath) {
      this.setData({ loading: false, loadError: '没有可对比的图片' });
      return;
    }

    const opt = pending.options || {};
    this.setData({
      title: opt.title || '对比查看',
      mode: opt.mode === 'toggle' ? 'toggle' : 'slide',
      showInfo: !!opt.showInfo,
      originalLabel: opt.originalLabel || '原图',
      processedLabel: opt.processedLabel || '处理后'
    });

    this._pending = pending;
    // 缩放 / 平移 / 触摸状态（不放入 data）
    this._scale = 1;
    this._offsetX = 0;
    this._offsetY = 0;
    this._touchMode = null; // 'divider' | 'pinch'
  },

  onReady() {
    if (!this._pending) return;
    if (this.data.mode === 'slide') {
      this._initCanvas().then(() => {
        // canvas 节点未就绪（重试后仍失败）时给出明确错误，避免空白无反馈
        if (!this._canvas) {
          this.setData({ loading: false, loadError: '对比组件初始化失败，请返回重试' });
          return;
        }
        this._loadImages();
      });
    } else {
      this._loadImages();
    }
  },

  /**
   * 初始化 Canvas 2D 节点（dpr 适配）
   */
  _initCanvas() {
    return new Promise((resolve) => {
      let attempts = 0;
      const MAX_ATTEMPTS = 8;
      const tryQuery = () => {
        attempts++;
        const query = wx.createSelectorQuery();
        query.select('#cmpCanvas').fields({ node: true, size: true, rect: true }).exec((res) => {
          if (res && res[0] && res[0].node && res[0].width > 0) {
            const canvas = res[0].node;
            const ctx = canvas.getContext('2d');
            const dpr = (wx.getSystemInfoSync().pixelRatio) || 1;
            const width = res[0].width;
            const height = res[0].height;

            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.scale(dpr, dpr);

            // [DEBUG] 立即填充红色，验证 canvas 元素是否真的在屏幕上渲染
            // 看到「红色」=canvas 能渲染；一直红=drawSlide 没跑；红一下变图=正常；红一下变空白=图没画上
            ctx.fillStyle = '#FF003C';
            ctx.fillRect(0, 0, width, height);

            this._canvas = canvas;
            this._ctx = ctx;
            this._dpr = dpr;
            this._canvasW = width;
            this._canvasH = height;
            this._rectLeft = res[0].left || 0;
            this._rectTop = res[0].top || 0;
            this._dividerX = width / 2;

            resolve();
          } else if (attempts < MAX_ATTEMPTS) {
            // canvas 节点尚未就绪（onReady 时机 / lazyCodeLoading 渲染延迟），稍后重试
            setTimeout(tryQuery, 60);
          } else {
            console.warn('[compare] canvas 节点未就绪，已重试', MAX_ATTEMPTS, '次');
            resolve();
          }
        });
      };
      tryQuery();
    });
  },

  /**
   * 下载归一化图片路径并加载
   */
  _loadImages() {
    const pending = this._pending;
    this.setData({ loading: true, loadError: '' });

    compareHelper
      .normalizeImagePaths([pending.originalPath, pending.processedPath])
      .then(([oPath, pPath]) => {
        // 信息栏用：获取宽高
        return Promise.all([
          Promise.resolve(oPath),
          Promise.resolve(pPath),
          imageProcess.getImageInfo(oPath).catch(() => null),
          imageProcess.getImageInfo(pPath).catch(() => null)
        ]);
      })
      .then(([oPath, pPath, oInfo, pInfo]) => {
        this._oInfo = oInfo;
        this._pInfo = pInfo;

        const patch = {
          originalLocalPath: oPath,
          processedLocalPath: pPath,
          loading: false
        };
        if (this.data.showInfo) {
          patch.originalSizeText = oInfo ? `${oInfo.width}×${oInfo.height}` : '';
          patch.processedSizeText = pInfo ? `${pInfo.width}×${pInfo.height}` : '';
        }
        this.setData(patch);

        // 滑动模式需要预加载到 Canvas Image
        if (this.data.mode === 'slide') {
          this._preloadCanvasImages(oPath, pPath)
            .then(() => {
              this._computeFit();
              this.drawSlide();
            })
            .catch((err) => {
              console.error('[compare] canvas 图片加载失败', err);
              this.setData({ loadError: '对比图片加载失败，请返回重试' });
            });
        }
      })
      .catch((err) => {
        console.error('加载对比图片失败', err);
        this.setData({ loading: false, loadError: '图片加载失败，请返回重试' });
      });
  },

  /**
   * 把两张图预加载为 Canvas Image 对象
   */
  _preloadCanvasImages(oPath, pPath) {
    const canvas = this._canvas;
    if (!canvas) return Promise.resolve();

    // canvas.createImage() 对 cloud:// / 远程 https 支持不稳定（DOM <image> 更宽松），
    // 先用 getImageInfo 归一化到本地可绘制路径，再喂给 canvas。
    const localize = (src) => new Promise((resolve) => {
      wx.getImageInfo({
        src: src,
        success: (info) => {resolve(info.path || src); },
        fail: (e) => { console.warn('[compare] getImageInfo fail', src, e && e.errMsg); resolve(src); }
      });
    });

    const loadOne = (src) => localize(src).then((local) => new Promise((resolve, reject) => {
      const img = canvas.createImage();
      img.onload = () => { resolve(img); };
      img.onerror = (e) => { console.warn('[compare] image onerror', e); reject(e); };
      img.src = local;
    }));

    return Promise.all([loadOne(oPath), loadOne(pPath)]).then(([o, p]) => {
      this._originalImg = o;
      this._processedImg = p;
    });
  },

  /**
   * 以原图宽高比计算 aspectFit 适配矩形
   */
  _computeFit() {
    const info = this._oInfo || this._pInfo;
    const cw = this._canvasW;
    const ch = this._canvasH;
    if (!info || !cw || !ch) {
      this._fitRect = { x: 0, y: 0, w: cw || 0, h: ch || 0 };
      return;
    }
    const ratio = Math.min(cw / info.width, ch / info.height);
    const w = info.width * ratio;
    const h = info.height * ratio;
    this._fitRect = {
      x: (cw - w) / 2,
      y: (ch - h) / 2,
      w: w,
      h: h
    };
  },

  /**
   * 绘制滑动对比：右=处理后整图，左=原图（裁剪到分割线左侧）+ 霓虹分割线
   */
  drawSlide() {
    const ctx = this._ctx;
    const ready = !!(ctx && this._originalImg && this._processedImg && this._fitRect);
    if (!ready) return;

    const cw = this._canvasW;
    const ch = this._canvasH;
    const fit = this._fitRect;
    const scale = this._scale;
    const offX = this._offsetX;
    const offY = this._offsetY;

    // 缩放/平移后的绘制矩形（以 fit 中心为缩放原点）
    const cx = fit.x + fit.w / 2;
    const cy = fit.y + fit.h / 2;
    const dw = fit.w * scale;
    const dh = fit.h * scale;
    const dx = cx - dw / 2 + offX;
    const dy = cy - dh / 2 + offY;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0A0E27';
    ctx.fillRect(0, 0, cw, ch);

    // 右：处理后（整图）
    ctx.drawImage(this._processedImg, dx, dy, dw, dh);

    // 左：原图（裁剪到分割线左侧）
    const dividerX = Math.max(0, Math.min(cw, this._dividerX));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, dividerX, ch);
    ctx.clip();
    ctx.drawImage(this._originalImg, dx, dy, dw, dh);
    ctx.restore();

    this._drawDivider(dividerX);

    if (this.data.zoomed !== (scale > 1.01)) {
      this.setData({ zoomed: scale > 1.01 });
    }
  },

  /**
   * 绘制霓虹蓝分割线 + 手柄
   */
  _drawDivider(x) {
    const ctx = this._ctx;
    const ch = this._canvasH;
    const hy = ch / 2;

    ctx.save();
    ctx.lineCap = 'round';

    // 外发光线
    ctx.shadowColor = '#00F0FF';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = '#00F0FF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ch);
    ctx.stroke();

    // 核心高亮线
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ch);
    ctx.stroke();

    // 手柄圆
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#00F0FF';
    ctx.beginPath();
    ctx.arc(x, hy, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0A0E27';
    ctx.beginPath();
    ctx.arc(x, hy, 10, 0, Math.PI * 2);
    ctx.fill();

    // 左右箭头
    ctx.fillStyle = '#00F0FF';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⇆', x, hy + 1);
    ctx.restore();
  },

  // ===================================
  // 模式切换
  // ===================================
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;

    // 切到切换模式时重置缩放状态
    this._scale = 1;
    this._offsetX = 0;
    this._offsetY = 0;

    this.setData({ mode: mode, zoomed: false });

    // 切回滑动模式：canvas 重新挂载，需重新初始化并绘制
    if (mode === 'slide') {
      wx.nextTick(() => {
        this._initCanvas().then(() => {
          if (this.data.originalLocalPath && this.data.processedLocalPath) {
            this._preloadCanvasImages(
              this.data.originalLocalPath,
              this.data.processedLocalPath
            ).then(() => {
              this._computeFit();
              this.drawSlide();
            });
          }
        });
      });
    }
  },

  // ===================================
  // 切换模式交互
  // ===================================
  onToggleTap() {
    this.setData({ showOriginal: !this.data.showOriginal });
  },

  /**
   * 复位缩放
   */
  resetZoom() {
    this._scale = 1;
    this._offsetX = 0;
    this._offsetY = 0;
    this.drawSlide();
  },

  // ===================================
  // 触摸（滑动模式）：单指拖分割线，双指缩放+平移
  // ===================================

  /**
   * 把 touch 对象解析为相对画布的坐标 {x, y}
   * （canvas 触摸事件给出 .x/.y；部分版本给 .clientX/.clientY，需减去画布偏移）
   */
  _toCanvasPoint(touch) {
    if (!touch) return { x: 0, y: 0 };
    if (touch.x !== undefined) {
      return { x: touch.x, y: touch.y };
    }
    return {
      x: (touch.clientX || 0) - (this._rectLeft || 0),
      y: (touch.clientY || 0) - (this._rectTop || 0)
    };
  },

  onCanvasTouchStart(e) {
    const raw = e.touches || [];
    if (raw.length === 0) return;
    const pts = raw.map((t) => this._toCanvasPoint(t));

    if (pts.length === 1) {
      this._touchMode = 'divider';
      this._lastX = pts[0].x;
    } else if (pts.length >= 2) {
      this._touchMode = 'pinch';
      this._startPinch(pts);
    }
  },

  onCanvasTouchMove(e) {
    const raw = e.touches || [];
    if (this._touchMode === 'divider' && raw.length === 1) {
      const p = this._toCanvasPoint(raw[0]);
      this._dividerX = Math.max(0, Math.min(this._canvasW, p.x));
      this.drawSlide();
    } else if (this._touchMode === 'pinch' && raw.length >= 2) {
      this._updatePinch(raw.map((t) => this._toCanvasPoint(t)));
    }
  },

  onCanvasTouchEnd(e) {
    const raw = e.touches || [];
    if (raw.length === 0) {
      this._touchMode = null;
      // 缩放回归 1 时自动归位
      if (this._scale <= 1.01) {
        this._scale = 1;
        this._offsetX = 0;
        this._offsetY = 0;
        this.drawSlide();
      }
    } else if (raw.length === 1) {
      // 双指抬起变单指：切回分割线拖拽
      this._touchMode = 'divider';
      this._lastX = this._toCanvasPoint(raw[0]).x;
    }
  },

  /**
   * 开始双指手势：记录初始距离、缩放、中点及中点下的图像局部坐标
   */
  _startPinch(pts) {
    const t0 = pts[0];
    const t1 = pts[1];
    this._startDist = this._distance(t0, t1);
    this._startScale = this._scale;
    this._startMid = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };

    const fit = this._fitRect;
    const cx = fit.x + fit.w / 2;
    const cy = fit.y + fit.h / 2;
    const s = this._startScale > 0 ? this._startScale : 1;
    this._startImgLocal = {
      x: (this._startMid.x - cx - this._offsetX) / s,
      y: (this._startMid.y - cy - this._offsetY) / s
    };
  },

  /**
   * 更新双指手势：以中点为锚点缩放，并跟随中点平移
   */
  _updatePinch(pts) {
    const t0 = pts[0];
    const t1 = pts[1];
    const dist = this._distance(t0, t1);
    const mid = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };
    const ratio = this._startDist > 0 ? dist / this._startDist : 1;
    let newScale = this._startScale * ratio;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

    const fit = this._fitRect;
    const cx = fit.x + fit.w / 2;
    const cy = fit.y + fit.h / 2;

    this._scale = newScale;
    this._offsetX = mid.x - cx - this._startImgLocal.x * newScale;
    this._offsetY = mid.y - cy - this._startImgLocal.y * newScale;

    this.drawSlide();
  },

  _distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  onUnload() {
    this._canvas = null;
    this._ctx = null;
    this._originalImg = null;
    this._processedImg = null;
  }
});
