// pages/aiMatting/aiMatting.js
// AI智能抠图页面（腾讯云 SegmentPortraitPic，主体清晰即可，人物/动物等均可）
//
// 云函数返回约定（见 cloudfunctions/aiMatting/index.js）：
//   success:true  → fileID（真实抠图后的透明 PNG）
//   success:false → error（标准化错误：未检测到主体引导 / 通用重试）
// 旧版"返原图当抠图结果 + 假识别置信度"的兜底已移除——失败即显错误 + 重试，不伪装成功。
const compareHelper = require('../../utils/compare-helper');

Page({
  data: {
    imageSrc: '',
    fileID: '',
    resultSrc: '',
    resultFileID: '',
    selectedType: 'portrait',
    selectedTypeLabel: '智能抠图',
    selectedBgColorLabel: '透明',
    backgroundColors: [
      { name: '透明', value: 'transparent', color: '#f0f0f0' },
      { name: '白色', value: '#ffffff', color: '#ffffff' },
      { name: '黑色', value: '#000000', color: '#000000' },
      { name: '红色', value: '#ff4757', color: '#ff4757' },
      { name: '蓝色', value: '#1e90ff', color: '#1e90ff' },
      { name: '绿色', value: '#2ed573', color: '#2ed573' }
    ],
    selectedBgColor: 'transparent',
    loading: false,
    // 失败态
    hasError: false,
    errorMsg: '',
    // 配额
    usedText: '',
    used: 0,
    limit: 20
  },

  onLoad() {
    this.loadQuota();
  },

  /**
   * 查询今日已用额度（只读，不消耗）。进页面时调一次，让额度条提前可见。
   * demo 态（未配置密钥）不展示额度条。
   */
  async loadQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiMatting',
        data: { action: 'quota' }
      });
      const r = (res && res.result) || {};
      console.log('[aiMatting] quota 返回', r);
      if (r.success && !r.demo) {
        this.setData({
          usedText: buildUsedText(r.used, r.limit),
          used: r.used || 0,
          limit: r.limit || this.data.limit
        });
      }
    } catch (e) {
      console.warn('[aiMatting] 查询额度失败', e && (e.errMsg || e.message));
    }
  },

  chooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(res) {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        that.setData({
          imageSrc: tempFilePath,
          fileID: '',
          resultSrc: '',
          resultFileID: '',
          hasError: false,
          errorMsg: ''
        });
        that.uploadImage(tempFilePath);
      }
    });
  },

  async uploadImage(filePath) {
    const that = this;
    // 内容安全：违规则拦截（已弹标准化提示，不暴露原因），并清掉已展示的图
    const { guardImage } = require('../../utils/content-check');
    if (!(await guardImage(filePath))) {
      this.setData({ imageSrc: '', fileID: '' });
      return;
    }
    wx.showLoading({ title: '上传中...', mask: true });
    const cloudPath = `aiMatting/${Date.now()}.jpg`;

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: res => {
        that.setData({ fileID: res.fileID });
        wx.hideLoading();
      },
      fail: err => {
        console.error('上传失败', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  selectBgColor(e) {
    const color = e.currentTarget.dataset.color;
    const selectedColor = this.data.backgroundColors.find(c => c.value === color);
    this.setData({
      selectedBgColor: color,
      selectedBgColorLabel: selectedColor.name
    });
  },

  async startMatting() {
    const that = this;
    if (!that.data.fileID) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }

    that.setData({ loading: true, hasError: false, errorMsg: '' });
    wx.showLoading({ title: 'AI抠图中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiMatting',
        data: {
          fileID: that.data.fileID,
          type: that.data.selectedType
        }
      });

      wx.hideLoading();

      if (res.result.success) {
        const fileID = res.result.fileID;
        // 真实抠图成功 → 取临时 URL 展示透明 PNG
        wx.cloud.getTempFileURL({
          fileList: [fileID]
        }).then(urlRes => {
          that.setData({
            resultSrc: urlRes.fileList[0].tempFileURL,
            resultFileID: fileID,
            usedText: buildUsedText(res.result.used, res.result.limit),
            used: res.result.used || 0,
            limit: res.result.limit || that.data.limit
          });
          wx.showModal({
            title: '✨ 抠图成功！',
            content: `已去除背景，生成透明PNG。\n\n当前背景：${that.getBgColorName()}`,
            showCancel: false,
            confirmText: '太棒了'
          });
        });
      } else if (res.result.error === 'rate_limit') {
        that.setData({
          hasError: true,
          errorMsg: `今日 ${res.result.limit || that.data.limit} 次抠图额度已用完，次日 0 点重置`,
          usedText: buildUsedText(res.result.used, res.result.limit),
          used: res.result.used || 0,
          limit: res.result.limit || that.data.limit
        });
      } else {
        // 失败：标准化错误 + 重试态（不再把原图当结果展示）
        that.setData({
          hasError: true,
          errorMsg: res.result.error || 'AI 抠图暂时不可用，请稍后重试'
        });
      }
    } catch (err) {
      console.error('调用失败', err);
      wx.hideLoading();
      that.setData({
        hasError: true,
        errorMsg: '网络异常，请稍后重试'
      });
    } finally {
      that.setData({ loading: false });
    }
  },

  /** 失败态重试 */
  retry() {
    this.startMatting();
  },

  getBgColorName() {
    const color = this.data.selectedBgColor;
    const colorMap = {
      'transparent': '透明',
      '#ffffff': '白色',
      '#000000': '黑色',
      '#ff4757': '红色',
      '#1e90ff': '蓝色',
      '#2ed573': '绿色'
    };
    return colorMap[color] || '透明';
  },

  saveResult() {
    if (!this.data.resultSrc) {
      wx.showToast({ title: '请先完成抠图', icon: 'none' });
      return;
    }

    wx.saveImageToPhotosAlbum({
      filePath: this.data.resultSrc,
      success() {
        wx.showToast({ title: '已保存', icon: 'success' });
      },
      fail(err) {
        console.error('保存失败', err);
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({
            title: '提示',
            content: '需要您授权保存图片到相册',
            showCancel: false
          });
        }
      }
    });
  },

  /**
   * 对比查看（原图 vs 抠图结果）
   */
  onCompare() {
    if (!this.data.imageSrc || !this.data.resultSrc) {
      wx.showToast({ title: '请先完成抠图', icon: 'none' });
      return;
    }
    compareHelper.navigateToCompare(this.data.imageSrc, this.data.resultSrc, {
      title: '抠图对比'
    });
  },

  previewOriginalImage() {
    if (!this.data.imageSrc) return;
    wx.previewImage({
      current: this.data.imageSrc,
      urls: [this.data.imageSrc]
    });
  },

  previewResultImage() {
    if (!this.data.resultSrc) return;
    wx.previewImage({
      current: this.data.resultSrc,
      urls: [this.data.resultSrc]
    });
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
