// pages/aiStyle/aiStyle.js
const compareHelper = require('../../utils/compare-helper');
const analytics = require('../../utils/analytics');

Page({
  data: {
    imageSrc: '',
    fileID: '',
    resultSrc: '',
    resultFileID: '',
    selectedStyle: 'anime',
    selectedStyleLabel: '日系动漫',
    styles: [
      { value: 'watercolor', label: '水彩画', icon: '💧' },
      { value: 'cartoon', label: '卡通插画', icon: '🎨' },
      { value: '3d-cartoon', label: '3D卡通', icon: '🎭' },
      { value: 'anime', label: '日系动漫', icon: '🎌' },
      { value: 'ancient', label: '唯美古风', icon: '🏮' },
      { value: '2.5d', label: '2.5D动画', icon: '🎬' },
      { value: 'wood-carving', label: '木雕', icon: '🪵' },
      { value: 'clay', label: '黏土', icon: '🟤' },
      { value: 'fresh-anime', label: '清新日漫', icon: '✨' },
      { value: 'comic', label: '小人书插画', icon: '📚' },
      { value: 'gongbi', label: '国风工笔', icon: '🖌️' },
      { value: 'jade', label: '玉石', icon: '💎' },
      { value: 'porcelain', label: '瓷器', icon: '🏺' },
      { value: 'felt-asia', label: '毛毡(亚洲版)', icon: '🧶' },
      { value: 'felt-west', label: '毛毡(欧美版)', icon: '🧵' },
      { value: 'vintage-us', label: '美式复古', icon: '🎞️' },
      { value: 'steampunk', label: '蒸汽朋克', icon: '⚙️' },
      { value: 'cyberpunk', label: '赛博朋克', icon: '🌃' },
      { value: 'sketch', label: '素描', icon: '✏️' },
      { value: 'monet', label: '莫奈花园', icon: '🌸' },
      { value: 'impasto', label: '厚涂手绘', icon: '🖼️' }
    ],
    loading: false,
    usedText: '',
    used: 0,
    limit: 20
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'aiStyle' });
    this.loadQuota();
  },

  /**
   * 查询今日已用额度（只读，不消耗）。进页面时调一次，让额度条提前可见。
   * demo 态（未配置密钥）不展示额度条。
   */
  async loadQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiStyleTransfer',
        data: { action: 'quota' }
      });
      const r = (res && res.result) || {};
      console.log('[aiStyle] quota 返回', r);
      if (r.success && !r.demo) {
        this.setData({
          usedText: buildUsedText(r.used, r.limit),
          used: r.used || 0,
          limit: r.limit || this.data.limit
        });
      }
    } catch (e) {
      console.warn('[aiStyle] 查询额度失败', e && (e.errMsg || e.message));
    }
  },

  /**
   * 图片上传组件回调 - 图片列表变化
   * 替换原有的 chooseImage，图片选择后自动上传到云存储
   */
  async onImageChange(e) {
    const { paths, count } = e.detail;

    if (count === 0) {
      this.setData({ imageSrc: '', fileID: '', resultSrc: '', resultFileID: '' });
      return;
    }

    const filePath = paths[0];
    this.setData({
      imageSrc: filePath,
      fileID: '',
      resultSrc: '',
      resultFileID: ''
    });

    // 内容安全检测 + 上传到云存储
    await this.uploadImage(filePath);
  },

  previewOriginalImage() {
    if (!this.data.imageSrc) {
      return;
    }
    const urls = [this.data.imageSrc];
    if (this.data.resultSrc) {
      urls.push(this.data.resultSrc);
    }
    wx.previewImage({
      current: this.data.imageSrc,
      urls: urls
    });
  },

  previewResultImage() {
    if (!this.data.resultSrc) {
      wx.showToast({ title: '暂无结果图片', icon: 'none' });
      return;
    }
    const urls = [this.data.resultSrc];
    if (this.data.imageSrc) {
      urls.unshift(this.data.imageSrc);
    }
    wx.previewImage({
      current: this.data.resultSrc,
      urls: urls
    });
  },

  async uploadImage(filePath) {
    const that = this;
    const { guardImage } = require('../../utils/content-check');
    if (!(await guardImage(filePath))) {
      // 内容安全拦截，清空已展示的图
      this.setData({ imageSrc: '', fileID: '', resultSrc: '', resultFileID: '' });
      // 通知组件清空
      const uploader = this.selectComponent('#mainUploader');
      if (uploader && uploader.clear) uploader.clear();
      return;
    }
    wx.showLoading({ title: '上传中...' });
    wx.cloud.uploadFile({
      cloudPath: `aiStyle/${Date.now()}.jpg`,
      filePath: filePath,
      success: res => {
        that.setData({ fileID: res.fileID });
        wx.hideLoading();
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  selectStyle(e) {
    const styleValue = e.currentTarget.dataset.style;
    const styleObj = this.data.styles.find(s => s.value === styleValue);

    this.setData({
      selectedStyle: styleValue,
      selectedStyleLabel: styleObj ? styleObj.label : '请选择',
      resultSrc: '',
      resultFileID: ''
    });
  },

  async transferStyle() {
    const that = this;
    if (!that.data.fileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    that.setData({ loading: true });
    wx.showLoading({ title: '风格迁移中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiStyleTransfer',
        data: { fileID: that.data.fileID, style: that.data.selectedStyle }
      });
      wx.hideLoading();


      if (res.result.success) {
        const resultFileID = res.result.fileID;
        const styleName = res.result.styleName;


        // 先下载图片到本地（更可靠）
        wx.showLoading({ title: '加载结果中...', mask: true });

        wx.cloud.downloadFile({
          fileID: resultFileID,
          success: downloadRes => {

            that.setData({
              resultSrc: downloadRes.tempFilePath,  // 使用本地临时文件路径
              resultFileID: resultFileID,
              usedText: buildUsedText(res.result.used, res.result.limit),
              used: res.result.used || 0,
              limit: res.result.limit || that.data.limit
            });
            analytics.track('tool_complete', { toolId: 'aiStyle' });


            wx.hideLoading();

            wx.showModal({
              title: '✨ 风格转换成功！',
              content: `已将图片转换为${styleName}，使用腾讯云图像风格化生成。`,
              showCancel: false,
              confirmText: '太棒了'
            });
          },
          fail: err => {
            wx.hideLoading();
            console.error('下载结果图片失败:', err);
            wx.showToast({
              title: '加载结果失败',
              icon: 'none',
              duration: 2000
            });
          }
        });
      } else if (res.result.error === 'rate_limit') {
        that.setData({
          usedText: buildUsedText(res.result.used, res.result.limit),
          used: res.result.used || 0,
          limit: res.result.limit || that.data.limit
        });
        wx.showModal({
          title: '额度已用完',
          content: `今日风格迁移 ${res.result.limit || that.data.limit} 次额度已用完，次日 0 点重置`,
          showCancel: false
        });
      } else {
        // 显示错误信息
        wx.showModal({
          title: '转换失败',
          content: res.result.error || '未知错误',
          showCancel: false
        });
      }
    } catch (err) {
      console.error('调用失败:', err);
      wx.hideLoading();

      // 显示详细错误
      let errorMsg = '风格迁移失败\n\n';
      errorMsg += `错误信息：${err.message || err.errMsg || '未知错误'}\n\n`;
      errorMsg += `可能原因：\n`;
      errorMsg += `1. 混元文生图API未开通或权限不足\n`;
      errorMsg += `2. API密钥配置错误\n`;
      errorMsg += `3. 云函数未部署\n\n`;
      errorMsg += `建议：查看云函数日志获取详细错误信息`;

      wx.showModal({
        title: '处理失败',
        content: errorMsg,
        showCancel: false,
        confirmText: '我知道了'
      });
    } finally {
      that.setData({ loading: false });
    }
  },

  saveResult() {
    if (!this.data.resultSrc) {
      wx.showToast({ title: '请先完成风格转换', icon: 'none' });
      return;
    }

    const that = this;

    // 先获取相册写入权限
    wx.getSetting({
      success(res) {
        if (!res.authSetting['scope.writePhotosAlbum']) {
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success() {
              // 授权成功，下载并保存图片
              that.downloadAndSaveImage();
            },
            fail() {
              wx.showModal({
                title: '提示',
                content: '需要您授权保存图片到相册',
                showCancel: false
              });
            }
          });
        } else {
          // 已有权限，直接下载并保存
          that.downloadAndSaveImage();
        }
      }
    });
  },

  downloadAndSaveImage() {
    const that = this;

    // resultSrc 已经是本地路径了，直接保存

    wx.saveImageToPhotosAlbum({
      filePath: that.data.resultSrc,
      success() {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail(err) {
        console.error('保存失败', err);
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({
            title: '提示',
            content: '需要您授权保存图片到相册',
            showCancel: false
          });
        } else {
          wx.showToast({
            title: '保存失败',
            icon: 'none'
          });
        }
      }
    });
  },

  /**
   * 对比查看（原图 vs 风格转换结果）
   */
  onCompare() {
    if (!this.data.imageSrc || !this.data.resultSrc) {
      wx.showToast({ title: '请先完成风格转换', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.resultSrc, {
      title: '风格对比'
    });
  },

  onImageLoad(e) {
  },

  onImageError(e) {
    console.error('结果图片加载失败', e.detail);
    wx.showToast({
      title: '图片加载失败',
      icon: 'none',
      duration: 2000
    });
  },

  /**
   * 重置并重新选择图片
   * 点击"重新选择"按钮后，清空结果图，重新显示上传区
   */
  resetAndReselect() {
    this.setData({ resultSrc: '', resultFileID: '' });
  },

  onShareAppMessage() {
    analytics.trackShare('aiStyle', 'friend');
    return {
      title: 'AI 风格迁移：照片秒变油画/动漫/古风',
      path: '/pages/aiStyle/aiStyle',
      imageUrl: this.data.resultSrc || ''
    };
  },

  onShareTimeline() {
    analytics.trackShare('aiStyle', 'timeline');
    return { title: '把照片变成油画/动漫/古风，AI 风格迁移' };
  }
});

/**
 * 构造今日额度文案。仅密钥可用时云函数才返回 used/limit；缺失/demo 则返回空串（不展示）。
 */
function buildUsedText(used, limit) {
  const u = Number(used);
  const l = Number(limit);
  if (!isFinite(u) || !isFinite(l) || l <= 0) return '';
  return `今日已用 ${u}/${l} 次`;
}
