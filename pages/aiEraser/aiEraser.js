// pages/aiEraser/aiEraser.js
// AI 智能去水印页面 —— Canvas 涂抹 + 云端 AI + 本地模糊兜底

const compareHelper = require('../../utils/compare-helper');

Page({
  data: {
    // 图片
    imageSrc: '',       // 原图临时路径
    fileID: '',         // 云存储 fileID
    resultSrc: '',      // 结果图路径
    resultFileID: '',   // 结果 fileID

    // Canvas
    canvasHeight: 300,   // Canvas 显示高度（px，动态计算）

    // 画笔
    brushSize: 30,      // 笔刷大小 (px)
    hasPainted: false,  // 是否已有涂抹
    strokeCount: 0,     // 笔画数（用于撤销按钮状态）

    // 状态
    processing: false,
    progress: 0,
    statusText: '',
    errorMsg: '',

    // 结果信息
    degraded: false,
    degradeReason: '',
    engine: '',
    engineText: ''
  },

  // ============================================================
  // 生命周期
  // ============================================================
  onLoad() {
    this._canvas = null;
    this._ctx = null;
    this._dpr = wx.getSystemInfoSync().pixelRatio;
    this._screenWidth = wx.getSystemInfoSync().windowWidth; // 屏幕宽度 px
    this._imgObj = null;       // Canvas Image 对象
    this._imgWidth = 0;        // 图片原始宽
    this._imgHeight = 0;       // 图片原始高
    this._canvasWidth = 0;     // Canvas 显示宽（CSS 像素）
    this._canvasHeight = 0;    // Canvas 显示高（CSS 像素）
    this._canvasRect = null;   // Canvas 画布的 boundingClientRect
    this._scale = 1;           // 图片→canvas 的缩放比
    this._drawOffsetX = 0;    // 图片在 canvas 中的绘制偏移 X
    this._drawOffsetY = 0;    // 图片在 canvas 中的绘制偏移 Y
    this._strokes = [];        // 笔画历史 [{points:[{x,y}], size}]
    this._currentStroke = null; // 当前正在画的笔画
    this._isDrawing = false;
    this._canvasReady = false;   // Canvas 是否已初始化完成
  },

  onReady() {
    // 延迟到图片加载后再初始化 canvas
  },

  // ============================================================
  // 步骤 1：选择图片
  // ============================================================
  chooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(res) {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        // 先获取图片尺寸，计算 canvas 高度
        wx.getImageInfo({
          src: tempFilePath,
          success(imgInfo) {
            // 计算 canvas 宽度（屏幕宽度 - 左右 padding 40rpx*2 = 80rpx ≈ 40px）
            // 容器 padding 是 20rpx 左右，但 .container 有 padding，.step-section 也有间距
            // 简化：canvas 宽度 ≈ 屏幕宽度 - 40px（左右各 20rpx 的 padding + border）
            const canvasCSSWidth = that._screenWidth - 40; // 大约值，实际以 selectorQuery 为准
            // 按图片比例计算 canvas 高度（contain 模式）
            const ratio = imgInfo.height / imgInfo.width;
            const canvasCSSHeight = Math.round(canvasCSSWidth * ratio);
            // 限制最大高度，避免长图占满屏幕
            const maxHeight = Math.round(that._screenWidth * 1.2);
            const finalHeight = Math.min(canvasCSSHeight, maxHeight);

            that.setData({
              imageSrc: tempFilePath,
              fileID: '',
              resultSrc: '',
              resultFileID: '',
              hasPainted: false,
              strokeCount: 0,
              degraded: false,
              errorMsg: '',
              canvasHeight: finalHeight
            });

            that._strokes = [];
            that._imgWidth = imgInfo.width;
            that._imgHeight = imgInfo.height;
            that.uploadImage(tempFilePath);

            // 等 DOM 渲染（canvas 高度已通过 data 设置）后再初始化 canvas
            setTimeout(() => that.initCanvas(), 200);
          },
          fail(err) {
            console.error('[aiEraser] 获取图片信息失败', err);
            wx.showToast({ title: '图片加载失败', icon: 'none' });
          }
        });
      }
    });
  },

  async uploadImage(filePath) {
    const that = this;
    // 内容安全检测
    try {
      const { guardImage } = require('../../utils/content-check');
      if (!(await guardImage(filePath))) {
        this.setData({ imageSrc: '', fileID: '' });
        return;
      }
    } catch (e) {
      console.warn('[aiEraser] 内容安全检测异常，继续', e.message);
    }

    wx.showLoading({ title: '上传中...', mask: true });
    const cloudPath = `aiEraser/${Date.now()}.jpg`;

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: res => {
        that.setData({ fileID: res.fileID });
        wx.hideLoading();
      },
      fail: err => {
        console.error('[aiEraser] 上传失败', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  // ============================================================
  // Canvas 初始化
  // ============================================================
  initCanvas() {
    const that = this;
    const query = wx.createSelectorQuery();
    query.select('#eraserCanvas')
      .fields({ node: true, size: true, rect: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          console.warn('[aiEraser] Canvas 节点获取失败，重试...');
          setTimeout(() => that.initCanvas(), 200);
          return;
        }

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = that._dpr;
        const displayWidth = res[0].width;   // CSS 像素宽度
        const displayHeight = res[0].height; // CSS 像素高度

        // 设置 canvas 实际像素尺寸（高分屏）
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        ctx.scale(dpr, dpr);

        that._canvas = canvas;
        that._ctx = ctx;
        that._canvasWidth = displayWidth;
        that._canvasHeight = displayHeight;
        that._canvasRect = {
          left: res[0].left,
          top: res[0].top,
          width: displayWidth,
          height: displayHeight
        };

        console.log('[aiEraser] Canvas 初始化:', {
          displayWidth, displayHeight,
          pixelWidth: canvas.width, pixelHeight: canvas.height,
          rectLeft: res[0].left, rectTop: res[0].top
        });

        // 加载图片到 canvas
        that.loadImageToCanvas();
      });
  },

  loadImageToCanvas() {
    const that = this;
    if (!that._canvas || !that.data.imageSrc) return;

    const img = that._canvas.createImage();
    img.onload = () => {
      that._imgObj = img;
      // 如果之前没拿到尺寸（极个别情况），从 image 对象取
      if (!that._imgWidth) that._imgWidth = img.width;
      if (!that._imgHeight) that._imgHeight = img.height;

      // 计算适配 canvas 尺寸的缩放 (contain)
      const canvasW = that._canvasWidth;
      const canvasH = that._canvasHeight;
      const scaleX = canvasW / img.width;
      const scaleY = canvasH / img.height;
      const scale = Math.min(scaleX, scaleY);

      that._scale = scale;
      that._drawOffsetX = (canvasW - img.width * scale) / 2;
      that._drawOffsetY = (canvasH - img.height * scale) / 2;

      console.log('[aiEraser] 图片加载完成:', {
        imgW: img.width, imgH: img.height,
        canvasW, canvasH, scale,
        offsetX: that._drawOffsetX, offsetY: that._drawOffsetY
      });

      that._canvasReady = true;
      that.redrawCanvas();
    };
    img.onerror = (err) => {
      console.error('[aiEraser] 图片加载失败', err);
      wx.showToast({ title: '图片加载失败', icon: 'none' });
    };
    img.src = that.data.imageSrc;
  },

  // ============================================================
  // 重绘整个 Canvas（原图 + 所有笔画蒙版）
  // ============================================================
  redrawCanvas() {
    const ctx = this._ctx;
    if (!ctx || !this._imgObj) return;

    const w = this._canvasWidth;
    const h = this._canvasHeight;

    // 清空
    ctx.clearRect(0, 0, w, h);

    // 绘制原图
    const imgW = this._imgWidth * this._scale;
    const imgH = this._imgHeight * this._scale;
    const offX = this._drawOffsetX;
    const offY = this._drawOffsetY;
    ctx.drawImage(this._imgObj, offX, offY, imgW, imgH);

    // 绘制蒙版叠加（半透明红色）
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255, 50, 80, 0.45)';
    ctx.strokeStyle = 'rgba(255, 50, 80, 0.45)';

    for (let i = 0; i < this._strokes.length; i++) {
      this._drawStroke(ctx, this._strokes[i]);
    }
    // 当前正在画的笔画
    if (this._currentStroke) {
      this._drawStroke(ctx, this._currentStroke);
    }
    ctx.restore();
  },

  _drawStroke(ctx, stroke) {
    const points = stroke.points;
    if (points.length === 0) return;

    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      // 单点
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }
  },

  // ============================================================
  // 触摸事件 —— 涂抹
  // ============================================================
  onTouchStart(e) {
    if (this.data.processing) return;
    const touch = e.touches[0];
    const pos = this._getCanvasPos(touch);

    this._isDrawing = true;
    this._currentStroke = {
      points: [pos],
      size: this.data.brushSize
    };

    this.redrawCanvas();
  },

  onTouchMove(e) {
    if (!this._isDrawing || this.data.processing) return;
    const touch = e.touches[0];
    const pos = this._getCanvasPos(touch);

    // 优化：采样点（避免太密影响性能）
    const last = this._currentStroke.points[this._currentStroke.points.length - 1];
    const dx = pos.x - last.x;
    const dy = pos.y - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 2) {
      this._currentStroke.points.push(pos);
      // 只追加绘制（优化性能，不必全量重绘）
      this._drawPartialStroke(last, pos, this._currentStroke.size);
    }
  },

  onTouchEnd() {
    if (!this._isDrawing) return;
    this._isDrawing = false;

    if (this._currentStroke && this._currentStroke.points.length > 0) {
      this._strokes.push(this._currentStroke);
      this.setData({
        hasPainted: true,
        strokeCount: this._strokes.length
      });
    }
    this._currentStroke = null;
    this.redrawCanvas();
  },

  // 增量绘制（提升滑动流畅度，60fps）
  _drawPartialStroke(from, to, size) {
    const ctx = this._ctx;
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 50, 80, 0.45)';
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  },

  // 将触摸坐标转为 canvas 内坐标（CSS 像素）
  // 注意：微信小程序中，canvas 组件上的 touch 事件坐标是相对 canvas 元素本身的
  // （不是相对页面的），所以可以直接使用 touch.x/touch.y
  // 参考：https://developers.weixin.qq.com/miniprogram/dev/component/canvas.html
  _getCanvasPos(touch) {
    return {
      x: touch.x,
      y: touch.y
    };
  },

  // ============================================================
  // 笔刷大小
  // ============================================================
  onBrushSizeChange(e) {
    this.setData({ brushSize: e.detail.value });
  },

  // ============================================================
  // 撤销 / 清除
  // ============================================================
  undoLastStroke() {
    if (this._strokes.length === 0) return;
    this._strokes.pop();
    this.setData({
      strokeCount: this._strokes.length,
      hasPainted: this._strokes.length > 0
    });
    this.redrawCanvas();
  },

  clearMask() {
    this._strokes = [];
    this._currentStroke = null;
    this.setData({ hasPainted: false, strokeCount: 0, errorMsg: '' });
    this.redrawCanvas();
  },

  // ============================================================
  // 步骤 3：一键修复
  // ============================================================
  async startRepair() {
    if (this.data.processing || !this.data.hasPainted) return;

    this.setData({
      processing: true,
      progress: 0,
      statusText: '正在生成蒙版...',
      errorMsg: ''
    });

    try {
      // 1. 生成蒙版图（纯黑白 PNG，涂抹区域为白色）
      const maskBase64 = await this.generateMaskBase64();
      this.setData({ progress: 10, statusText: '正在上传蒙版...' });

      // 2. 如果没有 fileID（上传失败等），直接走本地模糊
      if (!this.data.fileID) {
        console.warn('[aiEraser] 无 fileID，走本地模糊兜底');
        await this.localBlurFallback();
        return;
      }

      // 3. 调用云函数
      this.setData({ progress: 20, statusText: 'AI 正在修复中...' });

      try {
        const res = await wx.cloud.callFunction({
          name: 'aiEraser',
          data: {
            fileID: this.data.fileID,
            maskBase64: maskBase64
          }
        });

        const result = (res && res.result) || {};
        this.setData({ progress: 80, statusText: '处理结果中...' });

        if (result.success && result.fileID) {
          // 云端 AI 成功
          // 微信小程序 <image> 组件原生支持 cloud:// 协议的 fileID，无需转临时 URL
          // 这样更稳定，避免域名白名单和网络问题
          this.setData({
            resultSrc: result.fileID,
            resultFileID: result.fileID,
            progress: 100,
            processing: false,
            degraded: !!result.degraded,
            degradeReason: result.reason || '',
            engine: result.engine || '',
            engineText: this._getEngineLabel(result.engine, result.level)
          });
        } else {
          // 云端失败，走本地模糊兜底
          console.warn('[aiEraser] 云端失败，走本地模糊:', result.reason);
          this.setData({
            errorMsg: result.reason || '云端服务暂不可用，使用本地修复'
          });
          await this.localBlurFallback();
        }
      } catch (cloudErr) {
        console.warn('[aiEraser] 云函数调用失败，走本地模糊:', cloudErr);
        this.setData({
          errorMsg: '网络连接异常，使用本地修复模式'
        });
        await this.localBlurFallback();
      }

    } catch (err) {
      console.error('[aiEraser] 修复异常:', err);
      wx.showToast({ title: '处理失败', icon: 'none' });
      this.setData({ processing: false, progress: 0 });
    }
  },

  _getEngineLabel(engine, level) {
    if (engine === 'replicate-lama') return 'LaMa 高清';
    if (engine === 'huggingface-inpainting') return 'HF 推理';
    if (engine === 'local-blur-fallback') return '本地修复';
    return level ? `Level ${level}` : 'AI修复';
  },

  // ============================================================
  // 生成蒙版 Base64（纯黑白 PNG）
  // ============================================================
  generateMaskBase64() {
    return new Promise((resolve, reject) => {
      try {
        // 创建离屏 canvas 绘制蒙版
        const query = wx.createSelectorQuery();
        query.select('#eraserCanvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            try {
              const canvas = res[0].node;
              // 创建蒙版 canvas（和原图同尺寸）
              const maskCanvas = wx.createOffscreenCanvas
                ? wx.createOffscreenCanvas({ type: '2d', width: this._imgWidth, height: this._imgHeight })
                : canvas;

              // 优先使用 OffscreenCanvas（微信基础库 2.16.1+）
              let mCtx, mCanvas;
              if (wx.createOffscreenCanvas) {
                mCanvas = wx.createOffscreenCanvas({
                  type: '2d',
                  width: this._imgWidth,
                  height: this._imgHeight
                });
                mCtx = mCanvas.getContext('2d');
              } else {
                // 降级：复用现有 canvas（但会覆盖显示）
                mCanvas = canvas;
                mCtx = canvas.getContext('2d');
              }

              // 黑色背景
              mCtx.fillStyle = '#000000';
              mCtx.fillRect(0, 0, this._imgWidth, this._imgHeight);

              // 白色蒙版（按原始图片尺寸缩放绘制）
              const origScale = 1 / this._scale; // canvas 坐标 → 原图坐标
              mCtx.fillStyle = '#ffffff';
              mCtx.strokeStyle = '#ffffff';

              for (let i = 0; i < this._strokes.length; i++) {
                const stroke = this._strokes[i];
                const origSize = stroke.size * origScale;
                mCtx.lineWidth = origSize;
                mCtx.lineCap = 'round';
                mCtx.lineJoin = 'round';

                if (stroke.points.length === 1) {
                  const px = (stroke.points[0].x - this._drawOffsetX) * origScale;
                  const py = (stroke.points[0].y - this._drawOffsetY) * origScale;
                  mCtx.beginPath();
                  mCtx.arc(px, py, origSize / 2, 0, Math.PI * 2);
                  mCtx.fill();
                } else {
                  mCtx.beginPath();
                  const firstX = (stroke.points[0].x - this._drawOffsetX) * origScale;
                  const firstY = (stroke.points[0].y - this._drawOffsetY) * origScale;
                  mCtx.moveTo(firstX, firstY);
                  for (let j = 1; j < stroke.points.length; j++) {
                    const px = (stroke.points[j].x - this._drawOffsetX) * origScale;
                    const py = (stroke.points[j].y - this._drawOffsetY) * origScale;
                    mCtx.lineTo(px, py);
                  }
                  mCtx.stroke();
                }
              }

              // 导出 base64
              const base64 = mCanvas.toDataURL('image/png');
              resolve(base64);
            } catch (e) {
              reject(e);
            }
          });
      } catch (e) {
        reject(e);
      }
    });
  },

  // ============================================================
  // 三级降级：本地 Canvas 模糊填充
  // 算法：对蒙版区域的每个像素，取周围 5px 内非蒙版像素的平均值
  // ============================================================
  localBlurFallback() {
    const that = this;
    return new Promise((resolve) => {
      that.setData({
        progress: 30,
        statusText: '本地修复中（模糊填充）...',
        degraded: true,
        degradeReason: that.data.errorMsg || '云端服务不可用，已切换到本地模糊填充模式',
        engine: 'local-blur-fallback',
        engineText: '本地修复'
      });

      try {
        const query = wx.createSelectorQuery();
        query.select('#eraserCanvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            try {
              const canvas = res[0].node;
              const ctx = canvas.getContext('2d');
              const dpr = that._dpr;
              const dispW = that._canvasWidth;
              const dispH = that._canvasHeight;

              // 在显示尺寸上做模糊填充（性能考虑）
              const imgW = that._imgWidth * that._scale;
              const imgH = that._imgHeight * that._scale;
              const offX = that._drawOffsetX;
              const offY = that._drawOffsetY;

              // 获取原图像素数据
              ctx.clearRect(0, 0, dispW, dispH);
              ctx.drawImage(that._imgObj, offX, offY, imgW, imgH);

              const imgData = ctx.getImageData(offX, offY, imgW, imgH);
              const pixels = imgData.data;
              const w = imgW;
              const h = imgH;

              // 构建蒙版数组（布尔）
              const mask = new Uint8Array(w * h);
              for (let i = 0; i < that._strokes.length; i++) {
                const stroke = that._strokes[i];
                const radius = stroke.size / 2;
                for (let j = 0; j < stroke.points.length; j++) {
                  const px = Math.floor(stroke.points[j].x - offX);
                  const py = Math.floor(stroke.points[j].y - offY);
                  const r = Math.ceil(radius);
                  for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                      const x = px + dx;
                      const y = py + dy;
                      if (x < 0 || x >= w || y < 0 || y >= h) continue;
                      if (dx * dx + dy * dy <= radius * radius) {
                        mask[y * w + x] = 1;
                      }
                    }
                  }
                }
              }

              // 膨胀蒙版 2px（避免边缘硬边）
              const dilatedMask = new Uint8Array(mask.length);
              for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                  if (mask[y * w + x]) {
                    for (let dy = -2; dy <= 2; dy++) {
                      for (let dx = -2; dx <= 2; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                          dilatedMask[ny * w + nx] = 1;
                        }
                      }
                    }
                  }
                }
              }

              // 模糊填充：对蒙版像素取周围 5px 非蒙版像素的平均
              that.setData({ progress: 50 });

              const radius = 8; // 采样半径
              const output = new Uint8ClampedArray(pixels.length);
              // 先复制原图
              for (let i = 0; i < pixels.length; i++) output[i] = pixels[i];

              // 迭代 2 次，逐步填充（效果更好）
              for (let iter = 0; iter < 2; iter++) {
                // 使用当前 output 作为 source
                const src = new Uint8ClampedArray(output);
                for (let y = 0; y < h; y++) {
                  for (let x = 0; x < w; x++) {
                    if (!dilatedMask[y * w + x]) continue;

                    let r = 0, g = 0, b = 0, count = 0;
                    // 采样周围像素
                    for (let dy = -radius; dy <= radius; dy += 2) {
                      for (let dx = -radius; dx <= radius; dx += 2) {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        // 只取非蒙版像素
                        if (!dilatedMask[ny * w + nx]) {
                          const idx = (ny * w + nx) * 4;
                          r += src[idx];
                          g += src[idx + 1];
                          b += src[idx + 2];
                          count++;
                        }
                      }
                    }

                    if (count > 0) {
                      const idx = (y * w + x) * 4;
                      output[idx] = Math.round(r / count);
                      output[idx + 1] = Math.round(g / count);
                      output[idx + 2] = Math.round(b / count);
                      output[idx + 3] = 255;
                    }
                  }
                }
                // 标记已填充的蒙版像素为"非蒙版"，下一轮可以参与采样
                // (实际不修改 dilatedMask，因为迭代本身就是渐进填充)
                that.setData({ progress: 50 + (iter + 1) * 20 });
              }

              // 写回 imageData 并导出图片
              for (let i = 0; i < output.length; i++) imgData.data[i] = output[i];
              ctx.putImageData(imgData, offX, offY);

              // 导出临时文件
              wx.canvasToTempFilePath({
                canvas: canvas,
                fileType: 'png',
                quality: 0.95,
                success: (fileRes) => {
                  that.setData({
                    resultSrc: fileRes.tempFilePath,
                    progress: 100,
                    processing: false
                  });
                  resolve();
                },
                fail: (err) => {
                  console.error('[aiEraser] 导出失败', err);
                  that.setData({ processing: false });
                  wx.showToast({ title: '本地修复失败', icon: 'none' });
                  resolve();
                }
              }, this);

            } catch (e) {
              console.error('[aiEraser] 本地模糊异常:', e);
              that.setData({ processing: false });
              wx.showToast({ title: '本地修复失败', icon: 'none' });
              resolve();
            }
          });
      } catch (e) {
        console.error('[aiEraser] localBlurFallback 异常:', e);
        that.setData({ processing: false });
        resolve();
      }
    });
  },

  // ============================================================
  // 结果操作
  // ============================================================
  previewOriginal() {
    if (!this.data.imageSrc) return;
    wx.previewImage({ current: this.data.imageSrc, urls: [this.data.imageSrc] });
  },

  previewResult() {
    if (!this.data.resultSrc) return;
    wx.previewImage({ current: this.data.resultSrc, urls: [this.data.resultSrc] });
  },

  onCompare() {
    if (!this.data.imageSrc || !this.data.resultSrc) {
      wx.showToast({ title: '请先完成修复', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.resultSrc, {
      title: '去水印对比',
      originalLabel: '原图',
      processedLabel: '修复后'
    });
  },

  saveResult() {
    if (!this.data.resultSrc) {
      wx.showToast({ title: '请先完成修复', icon: 'none' });
      return;
    }

    const doSave = (filePath) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success() {
          wx.showToast({ title: '已保存到相册', icon: 'success' });
        },
        fail(err) {
          console.error('[aiEraser] 保存失败', err);
          if (err.errMsg && err.errMsg.includes('auth')) {
            wx.showModal({
              title: '提示',
              content: '需要您授权保存图片到相册',
              showCancel: false
            });
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' });
          }
        }
      });
    };

    // 分情况处理：cloud:// 文件 ID / 网络 URL / 本地路径
    const src = this.data.resultSrc;
    if (src.startsWith('cloud://')) {
      // 云存储 fileID：先获取临时 URL，再下载
      wx.showLoading({ title: '下载中...', mask: true });
      wx.cloud.getTempFileURL({
        fileList: [src],
        success: (urlRes) => {
          const tempUrl = urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL;
          if (!tempUrl) {
            wx.hideLoading();
            wx.showToast({ title: '获取图片地址失败', icon: 'none' });
            return;
          }
          wx.downloadFile({
            url: tempUrl,
            success: (downRes) => {
              wx.hideLoading();
              if (downRes.tempFilePath) {
                doSave(downRes.tempFilePath);
              } else {
                wx.showToast({ title: '下载失败', icon: 'none' });
              }
            },
            fail: (err) => {
              wx.hideLoading();
              console.error('[aiEraser] 下载失败', err);
              wx.showToast({ title: '下载失败', icon: 'none' });
            }
          });
        },
        fail: (err) => {
          wx.hideLoading();
          console.error('[aiEraser] 获取临时URL失败', err);
          wx.showToast({ title: '获取图片地址失败', icon: 'none' });
        }
      });
    } else if (src.startsWith('http://') || src.startsWith('https://')) {
      // 网络 URL：直接下载
      wx.showLoading({ title: '下载中...', mask: true });
      wx.downloadFile({
        url: src,
        success: (res) => {
          wx.hideLoading();
          if (res.tempFilePath) {
            doSave(res.tempFilePath);
          } else {
            wx.showToast({ title: '下载失败', icon: 'none' });
          }
        },
        fail: (err) => {
          wx.hideLoading();
          console.error('[aiEraser] 下载失败', err);
          wx.showToast({ title: '下载失败', icon: 'none' });
        }
      });
    } else {
      // 本地临时文件路径，直接保存
      doSave(src);
    }
  },

  resetAll() {
    this.setData({
      imageSrc: '',
      fileID: '',
      resultSrc: '',
      resultFileID: '',
      hasPainted: false,
      strokeCount: 0,
      processing: false,
      progress: 0,
      degraded: false,
      degradeReason: '',
      errorMsg: '',
      engine: '',
      engineText: ''
    });
    this._strokes = [];
    this._imgObj = null;
  },

  onShareAppMessage() {
    return {
      title: 'AI 智能去水印 - 一键去除图片水印',
      path: '/pages/aiEraser/aiEraser'
    };
  }
});
