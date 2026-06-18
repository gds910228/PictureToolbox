// pages/aiOCR/aiOCR.js
// AI文字识别页面 - 选择图片、识别、查看结果、复制导出

Page({
  data: {
    // 图片相关
    imageSrc: '',
    fileID: '',
    imageWidth: 0,    // 原始图片宽度
    imageHeight: 0,   // 原始图片高度
    displayWidth: 0,  // 显示宽度（px）
    displayHeight: 0, // 显示高度（px）

    // OCR结果
    textDetections: [],
    fullText: '',
    selectedIndex: -1,
    isMock: false,    // 是否为模拟数据（未配置密钥）

    // 状态
    loading: false,
    recognizing: false,
    showExportSheet: false,
    showSourceSheet: false,

    // 视图模式
    viewMode: 'split', // 'image' | 'result' | 'split'
  },

  onLoad() {
    // 计算显示区域宽度（屏幕宽度 - 左右padding）
    const sysInfo = wx.getSystemInfoSync();
    this.screenWidth = sysInfo.windowWidth;
    this.displayMaxWidth = sysInfo.windowWidth - 48; // 左右各24rpx = ... 实际用px计算
  },

  // ============ 图片选择 ============

  /**
   * 显示图片来源选择
   */
  chooseImage() {
    this.setData({ showSourceSheet: true });
  },

  onSourceSheetClose() {
    this.setData({ showSourceSheet: false });
  },

  /**
   * 从相册选择
   */
  chooseFromAlbum() {
    this.setData({ showSourceSheet: false });
    this._chooseMedia(['album']);
  },

  /**
   * 拍照
   */
  takePhoto() {
    this.setData({ showSourceSheet: false });
    this._chooseMedia(['camera']);
  },

  /**
   * 从聊天选择
   */
  chooseFromChat() {
    this.setData({ showSourceSheet: false });
    const that = this;

    if (!wx.chooseMessageFile) {
      wx.showToast({ title: '当前版本不支持从聊天选择', icon: 'none' });
      return;
    }

    wx.chooseMessageFile({
      count: 1,
      type: 'image',
      success(res) {
        const tempFilePath = res.tempFiles[0].path;
        that._handleImageSelected(tempFilePath);
      },
      fail() {
        // 用户取消
      }
    });
  },

  /**
   * 统一选择图片
   */
  _chooseMedia(sourceType) {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: sourceType,
      success(res) {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        that._handleImageSelected(tempFilePath);
      },
      fail() {
        // 用户取消
      }
    });
  },

  /**
   * 图片选中后处理
   */
  _handleImageSelected(tempFilePath) {
    const that = this;

    // 获取图片信息
    wx.getImageInfo({
      src: tempFilePath,
      success(info) {
        // 计算显示尺寸
        const maxWidth = wx.getSystemInfoSync().windowWidth - 48; // 24px左右边距
        const scale = Math.min(maxWidth / info.width, 1);
        const displayWidth = info.width * scale;
        const displayHeight = info.height * scale;

        that.setData({
          imageSrc: tempFilePath,
          imageWidth: info.width,
          imageHeight: info.height,
          displayWidth: displayWidth,
          displayHeight: displayHeight,
          fileID: '',
          textDetections: [],
          fullText: '',
          selectedIndex: -1,
          isMock: false
        });

        // 上传图片
        that.uploadImage(tempFilePath);
      },
      fail() {
        that.setData({ imageSrc: tempFilePath });
        that.uploadImage(tempFilePath);
      }
    });
  },

  // ============ 上传与识别 ============

  /**
   * 上传图片到云存储
   */
  async uploadImage(filePath) {
    const that = this;
    // 内容安全：违规则拦截（已弹标准化提示，不暴露原因），并清掉已展示的图
    const { guardImage } = require('../../utils/content-check');
    if (!(await guardImage(filePath))) {
      this.setData({ imageSrc: '', fileID: '' });
      return;
    }
    wx.showLoading({ title: '上传中...', mask: true });
    const cloudPath = `aiOCR/${Date.now()}.jpg`;

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: res => {
        that.setData({ fileID: res.fileID });
        wx.hideLoading();
        // 自动开始识别
        that.recognizeText();
      },
      fail: err => {
        console.error('上传失败', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  /**
   * 调用OCR识别
   */
  async recognizeText() {
    const that = this;
    if (!that.data.fileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }

    that.setData({ recognizing: true, loading: true });
    wx.showLoading({ title: '识别中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiOCR',
        data: {
          fileID: that.data.fileID
        }
      });

      wx.hideLoading();

      if (res.result && res.result.success) {
        const result = res.result;

        // 如果是模拟数据，提示用户
        if (result.textDetections && result.textDetections.length > 0 && result.textDetections[0].isMock !== undefined) {
          // 检查是否为mock
        }

        // 计算百分比坐标（便于适配不同屏幕）
        const detections = result.textDetections.map((item, idx) => {
          const imgW = result.imageWidth || that.data.imageWidth || 800;
          const imgH = result.imageHeight || that.data.imageHeight || 600;

          // 转换bbox为百分比
          const bboxPct = {
            x: (item.bbox.x / imgW) * 100,
            y: (item.bbox.y / imgH) * 100,
            width: (item.bbox.width / imgW) * 100,
            height: (item.bbox.height / imgH) * 100
          };

          // 转换polygon为百分比
          const polygonPct = (item.polygon || []).map(p => ({
            x: (p.x / imgW) * 100,
            y: (p.y / imgH) * 100
          }));

          return {
            ...item,
            index: idx,
            bboxPct: bboxPct,
            polygonPct: polygonPct
          };
        });

        that.setData({
          textDetections: detections,
          fullText: result.fullText || '',
          imageWidth: result.imageWidth || that.data.imageWidth,
          imageHeight: result.imageHeight || that.data.imageHeight,
          isMock: result.isMock || false
        });

        // 延迟绘制canvas，确保DOM已渲染
        setTimeout(() => {
          that.drawBoxes();
        }, 100);

        // 如果是模拟数据，给出友好提示
        if (result.isMock) {
          wx.showToast({
            title: '功能初始化中，展示示例数据',
            icon: 'none',
            duration: 3000
          });
        }

      } else {
        const errMsg = (res.result && res.result.error) || '识别失败';
        wx.showToast({ title: errMsg, icon: 'none' });
      }
    } catch (err) {
      console.error('调用OCR失败', err);
      wx.hideLoading();
      wx.showToast({ title: '识别失败', icon: 'none' });
    } finally {
      that.setData({ recognizing: false, loading: false });
    }
  },

  // ============ Canvas 绘制识别框 ============

  /**
   * 在Canvas上绘制识别框
   */
  drawBoxes() {
    const that = this;
    const query = wx.createSelectorQuery();

    query.select('#ocr-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;

        // 设置canvas实际尺寸（高清屏适配）
        const canvasWidth = that.data.displayWidth;
        const canvasHeight = that.data.displayHeight;

        canvas.width = canvasWidth * dpr;
        canvas.height = canvasHeight * dpr;
        ctx.scale(dpr, dpr);

        // 清空画布
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        const detections = that.data.textDetections;
        const selectedIndex = that.data.selectedIndex;

        detections.forEach((item, idx) => {
          const bbox = item.bboxPct;
          const x = (bbox.x / 100) * canvasWidth;
          const y = (bbox.y / 100) * canvasHeight;
          const w = (bbox.width / 100) * canvasWidth;
          const h = (bbox.height / 100) * canvasHeight;

          const isSelected = idx === selectedIndex;

          if (isSelected) {
            // 选中状态：高亮
            ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = '#00F0FF';
            ctx.lineWidth = 2.5;
            ctx.strokeRect(x, y, w, h);

            // 标签背景
            ctx.fillStyle = '#00F0FF';
            const label = `行${idx + 1}`;
            ctx.font = '11px sans-serif';
            const labelW = ctx.measureText(label).width + 8;
            ctx.fillRect(x, y - 18, labelW, 16);
            ctx.fillStyle = '#0A0E27';
            ctx.fillText(label, x + 4, y - 6);
          } else {
            // 普通状态
            ctx.fillStyle = 'rgba(255, 0, 128, 0.1)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = '#FF0080';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 2]);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
          }
        });

        that.canvasInstance = canvas;
        that.canvasCtx = ctx;
      });
  },

  /**
   * 点击canvas区域
   */
  onCanvasTap(e) {
    if (!this.data.textDetections.length) return;

    const { x, y } = e.detail;
    const canvasWidth = this.data.displayWidth;
    const canvasHeight = this.data.displayHeight;

    // 将点击坐标转换为百分比
    const pctX = (x / canvasWidth) * 100;
    const pctY = (y / canvasHeight) * 100;

    // 查找点击了哪个框
    let hitIndex = -1;
    for (let i = 0; i < this.data.textDetections.length; i++) {
      const bbox = this.data.textDetections[i].bboxPct;
      if (pctX >= bbox.x && pctX <= bbox.x + bbox.width &&
          pctY >= bbox.y && pctY <= bbox.y + bbox.height) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex >= 0) {
      this.highlightText(hitIndex);
    } else {
      this.setData({ selectedIndex: -1 });
      this.drawBoxes();
    }
  },

  /**
   * 点击文字行，高亮对应识别框
   */
  onTextItemTap(e) {
    const index = e.currentTarget.dataset.index;
    this.highlightText(index);
  },

  /**
   * 高亮指定行
   */
  highlightText(index) {
    this.setData({ selectedIndex: index });
    this.drawBoxes();

    // 滚动到对应文字位置
    if (index >= 0) {
      const query = wx.createSelectorQuery();
      query.select(`#text-item-${index}`).boundingClientRect();
      query.selectViewport().scrollOffset();
      query.exec((res) => {
        if (res[0] && res[1]) {
          wx.pageScrollTo({
            scrollTop: res[0].top + res[1].scrollTop - 200,
            duration: 300
          });
        }
      });
    }
  },

  // ============ 复制功能 ============

  /**
   * 复制全部文字
   */
  copyAllText() {
    if (!this.data.fullText) {
      wx.showToast({ title: '没有可复制的内容', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: this.data.fullText,
      success() {
        wx.showToast({ title: '已复制全部文字', icon: 'success' });
      }
    });
  },

  /**
   * 复制单行文字
   */
  copySingleText(e) {
    const text = e.currentTarget.dataset.text;
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  // ============ 导出功能 ============

  /**
   * 显示导出选项
   */
  showExportOptions() {
    if (!this.data.textDetections.length) {
      wx.showToast({ title: '请先进行识别', icon: 'none' });
      return;
    }
    this.setData({ showExportSheet: true });
  },

  onExportSheetClose() {
    this.setData({ showExportSheet: false });
  },

  /**
   * 导出纯文本
   */
  exportText() {
    this.setData({ showExportSheet: false });
    wx.setClipboardData({
      data: this.data.fullText,
      success() {
        wx.showToast({ title: '文本已复制', icon: 'success' });
      }
    });
  },

  /**
   * 导出JSON（带坐标）
   */
  exportJSON() {
    this.setData({ showExportSheet: false });

    const jsonData = {
      imageWidth: this.data.imageWidth,
      imageHeight: this.data.imageHeight,
      totalLines: this.data.textDetections.length,
      lines: this.data.textDetections.map(item => ({
        text: item.text,
        confidence: item.confidence,
        bbox: item.bbox,
        polygon: item.polygon
      }))
    };

    const jsonStr = JSON.stringify(jsonData, null, 2);
    wx.setClipboardData({
      data: jsonStr,
      success() {
        wx.showToast({ title: 'JSON已复制', icon: 'success' });
      }
    });
  },

  /**
   * 导出带框图片
   */
  exportImage() {
    this.setData({ showExportSheet: false });
    const that = this;

    wx.showLoading({ title: '生成中...', mask: true });

    // 获取canvas实例
    const query = wx.createSelectorQuery();
    query.select('#ocr-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          wx.hideLoading();
          wx.showToast({ title: '生成失败', icon: 'none' });
          return;
        }

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;
        const canvasWidth = that.data.displayWidth;
        const canvasHeight = that.data.displayHeight;

        canvas.width = canvasWidth * dpr;
        canvas.height = canvasHeight * dpr;
        ctx.scale(dpr, dpr);

        // 先绘制原图
        const img = canvas.createImage();
        img.onload = () => {
          // 绘制图片
          ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

          // 再绘制识别框
          const detections = that.data.textDetections;
          detections.forEach((item, idx) => {
            const bbox = item.bboxPct;
            const x = (bbox.x / 100) * canvasWidth;
            const y = (bbox.y / 100) * canvasHeight;
            const w = (bbox.width / 100) * canvasWidth;
            const h = (bbox.height / 100) * canvasHeight;

            // 半透明填充
            ctx.fillStyle = 'rgba(255, 0, 128, 0.15)';
            ctx.fillRect(x, y, w, h);

            // 边框
            ctx.strokeStyle = '#FF0080';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);

            // 行号标签
            ctx.fillStyle = '#FF0080';
            const label = `${idx + 1}`;
            ctx.font = 'bold 12px sans-serif';
            const labelW = ctx.measureText(label).width + 10;
            ctx.fillRect(x, y - 18, labelW, 16);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, x + 5, y - 6);
          });

          // 导出图片
          wx.canvasToTempFilePath({
            canvas: canvas,
            fileType: 'png',
            quality: 1,
            success(tempRes) {
              wx.hideLoading();

              // 保存到相册
              wx.saveImageToPhotosAlbum({
                filePath: tempRes.tempFilePath,
                success() {
                  wx.showToast({ title: '已保存到相册', icon: 'success' });
                  // 恢复只画框的模式
                  setTimeout(() => that.drawBoxes(), 500);
                },
                fail(err) {
                  if (err.errMsg && err.errMsg.indexOf('auth') > -1) {
                    wx.showModal({
                      title: '需要授权',
                      content: '请授权保存图片到相册',
                      confirmText: '去设置',
                      success(modalRes) {
                        if (modalRes.confirm) {
                          wx.openSetting();
                        }
                      }
                    });
                  } else {
                    wx.showToast({ title: '保存失败', icon: 'none' });
                  }
                  // 恢复只画框的模式
                  setTimeout(() => that.drawBoxes(), 500);
                }
              });
            },
            fail() {
              wx.hideLoading();
              wx.showToast({ title: '生成失败', icon: 'none' });
              setTimeout(() => that.drawBoxes(), 500);
            }
          });
        };
        img.onerror = () => {
          wx.hideLoading();
          wx.showToast({ title: '图片加载失败', icon: 'none' });
        };
        img.src = that.data.imageSrc;
      });
  },

  // ============ 视图切换 ============

  switchViewMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ viewMode: mode });

    if (mode !== 'image' && this.data.textDetections.length > 0) {
      setTimeout(() => {
        this.drawBoxes();
      }, 50);
    }
  },

  // ============ 分享功能 ============

  /**
   * 分享给朋友
   */
  onShareAppMessage() {
    let title = 'AI文字识别 - 图片转文字神器';
    if (this.data.fullText) {
      const preview = this.data.fullText.substring(0, 30);
      title = `识别结果: ${preview}...`;
    }
    return {
      title: title,
      path: '/pages/aiOCR/aiOCR',
      imageUrl: this.data.imageSrc || ''
    };
  },

  /**
   * 分享到朋友圈
   */
  onShareTimeline() {
    return {
      title: 'AI文字识别 - 图片转文字神器',
      imageUrl: this.data.imageSrc || ''
    };
  },

  /**
   * 点击分享按钮
   */
  shareResult() {
    if (!this.data.textDetections.length) {
      wx.showToast({ title: '请先进行识别', icon: 'none' });
      return;
    }
    // 触发右上角菜单
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    });
    wx.showToast({ title: '点击右上角分享', icon: 'none' });
  },

  // ============ 工具函数 ============

  /**
   * 重新选择图片
   */
  reselectImage() {
    this.setData({
      imageSrc: '',
      fileID: '',
      textDetections: [],
      fullText: '',
      selectedIndex: -1,
      isMock: false
    });
    this.chooseImage();
  }
});
