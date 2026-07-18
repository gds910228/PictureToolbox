// pages/exif/exif.js
// EXIF 元数据查看 / 抹除工具
// - wx.getImageInfo 读取基础信息（宽高、方向）
// - piexifjs 读写 EXIF（拍摄时间、设备、GPS、镜头参数等）
// - 抹除后重新保存图片，剥离所有元数据
//
// 注意：piexifjs 仅支持 JPEG (含 .jpg/.jpeg) 文件的 EXIF 读写。
// PNG/HEIC 等格式会提示用户。

const piexif = require('../../utils/piexif.js');
const TAGS = require('../../utils/exif-tags.js');
const analytics = require('../../utils/analytics');

Page({
  data: {
    imageSrc: '',         // 当前图片本地路径
    imageInfo: null,      // wx.getImageInfo 返回的基础信息
    imageSize: 0,
    imageSizeText: '',

    isJpeg: false,        // 是否 JPEG（决定能否处理 EXIF）
    formatHint: '',

    // EXIF 数据（已格式化为可展示）
    hasExif: false,
    exifGroups: [],       // [{ name, items: [{ label, value, sensitive }] }]
    rawTagCount: 0,

    // 抹除后的状态
    strippedPath: '',     // 抹除后保存的图片本地路径
    strippedSize: 0,
    strippedSizeText: '',
    strippedVerified: null, // null=未验证, true=已确认无元数据, false=仍有残留
    verifyMessage: '',

    processing: false,
    processStep: ''
  },

  onLoad() {
    analytics.track('tool_view', { toolId: 'exif' });
  },

  // ============ 选图 ============
  chooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],   // 必须选原图，否则微信会自动剥离 EXIF
      success(res) {
        const f = res.tempFiles[0];
        that.handleImage(f.tempFilePath, f.size);
      },
      fail(err) {
        if (err && err.errMsg && !/cancel/i.test(err.errMsg)) {
          wx.showToast({ title: '选择失败', icon: 'none' });
        }
      }
    });
  },

  handleImage(filePath, knownSize) {
    const that = this;
    that.resetResult();

    // 同时拿基础信息和文件大小
    wx.getImageInfo({
      src: filePath,
      success(info) {
        const isJpeg = /jpeg|jpg/i.test(info.type || '') || /\.jpe?g$/i.test(filePath);
        const sizePromise = (knownSize && knownSize > 0)
          ? Promise.resolve(knownSize)
          : that.getFileSize(filePath);

        sizePromise.then((size) => {
          that.setData({
            imageSrc: filePath,
            imageInfo: info,
            imageSize: size,
            imageSizeText: that.formatSize(size),
            isJpeg,
            formatHint: isJpeg ? '' : '当前图片非 JPEG 格式，无法读取/抹除 EXIF（PNG/WebP 通常不含 EXIF）'
          });

          if (isJpeg) {
            that.parseExif(filePath);
          } else {
            that.setData({ hasExif: false, exifGroups: [] });
          }
        });
      },
      fail() {
        wx.showToast({ title: '读取图片失败', icon: 'none' });
      }
    });
  },

  resetResult() {
    this.setData({
      strippedPath: '',
      strippedSize: 0,
      strippedSizeText: '',
      strippedVerified: null,
      verifyMessage: '',
      hasExif: false,
      exifGroups: [],
      rawTagCount: 0
    });
  },

  // ============ EXIF 读取 ============
  parseExif(filePath) {
    const that = this;
    that.setData({ processing: true, processStep: '解析 EXIF...' });

    that.readAsBase64(filePath).then((base64) => {
      const dataUrl = 'data:image/jpeg;base64,' + base64;
      let exifObj;
      try {
        exifObj = piexif.load(dataUrl);
      } catch (e) {
        console.warn('[exif] 解析失败', e);
        that.setData({
          processing: false,
          processStep: '',
          hasExif: false,
          exifGroups: [],
          rawTagCount: 0
        });
        wx.showToast({ title: '该图片不含 EXIF', icon: 'none' });
        return;
      }

      const groups = that.formatExif(exifObj);
      const tagCount = that.countTags(exifObj);

      that.setData({
        processing: false,
        processStep: '',
        hasExif: tagCount > 0,
        exifGroups: groups,
        rawTagCount: tagCount
      });
      analytics.track('tool_complete', { toolId: 'exif' });

      if (tagCount === 0) {
        wx.showToast({ title: '该图片不含 EXIF', icon: 'none' });
      }
    }).catch((err) => {
      console.error('[exif] 读取文件失败', err);
      that.setData({ processing: false, processStep: '' });
      wx.showToast({ title: '读取失败', icon: 'none' });
    });
  },

  countTags(exifObj) {
    let n = 0;
    ['0th', 'Exif', 'GPS', '1st', 'Interop'].forEach((k) => {
      if (exifObj[k]) n += Object.keys(exifObj[k]).length;
    });
    return n;
  },

  // 把 EXIF 整理成展示分组，并对常见敏感字段做友好格式化
  formatExif(exifObj) {
    const groups = [];

    // 设备 / 拍摄时间（来自 0th）
    const deviceItems = [];
    const zeroth = exifObj['0th'] || {};
    this.pushTag(deviceItems, zeroth, TAGS.IMAGE.Make, '设备厂商');
    this.pushTag(deviceItems, zeroth, TAGS.IMAGE.Model, '设备型号');
    this.pushTag(deviceItems, zeroth, TAGS.IMAGE.Software, '软件');
    this.pushTag(deviceItems, zeroth, TAGS.IMAGE.DateTime, '修改时间');
    this.pushTag(deviceItems, zeroth, TAGS.IMAGE.Artist, '作者', true);
    this.pushTag(deviceItems, zeroth, TAGS.IMAGE.Copyright, '版权');
    this.pushTag(deviceItems, zeroth, TAGS.IMAGE.ImageDescription, '描述');
    this.pushTag(deviceItems, zeroth, TAGS.IMAGE.Orientation, '方向', false, this.formatOrientation);
    if (deviceItems.length) {
      groups.push({ name: '📷 设备与基本信息', items: deviceItems });
    }

    // 拍摄参数（来自 Exif）
    const exifItems = [];
    const ex = exifObj['Exif'] || {};
    this.pushTag(exifItems, ex, TAGS.EXIF.DateTimeOriginal, '拍摄时间', true);
    this.pushTag(exifItems, ex, TAGS.EXIF.DateTimeDigitized, '数字化时间');
    this.pushTag(exifItems, ex, TAGS.EXIF.LensModel, '镜头型号');
    this.pushTag(exifItems, ex, TAGS.EXIF.LensMake, '镜头厂商');
    this.pushTag(exifItems, ex, TAGS.EXIF.FNumber, '光圈', false, this.formatFNumber);
    this.pushTag(exifItems, ex, TAGS.EXIF.ExposureTime, '曝光时间', false, this.formatExposure);
    this.pushTag(exifItems, ex, TAGS.EXIF.ISOSpeedRatings, 'ISO 感光度');
    this.pushTag(exifItems, ex, TAGS.EXIF.FocalLength, '焦距', false, this.formatFocal);
    this.pushTag(exifItems, ex, TAGS.EXIF.FocalLengthIn35mmFilm, '等效 35mm 焦距');
    this.pushTag(exifItems, ex, TAGS.EXIF.Flash, '闪光灯');
    this.pushTag(exifItems, ex, TAGS.EXIF.WhiteBalance, '白平衡', false, (v) => v === 0 ? '自动' : '手动');
    this.pushTag(exifItems, ex, TAGS.EXIF.PixelXDimension, '像素宽');
    this.pushTag(exifItems, ex, TAGS.EXIF.PixelYDimension, '像素高');
    if (exifItems.length) {
      groups.push({ name: '⚙️ 拍摄参数', items: exifItems });
    }

    // GPS 信息
    const gpsItems = [];
    const gps = exifObj['GPS'] || {};
    if (gps && Object.keys(gps).length) {
      const lat = this.dmsToDecimal(gps[TAGS.GPS.GPSLatitude], gps[TAGS.GPS.GPSLatitudeRef]);
      const lon = this.dmsToDecimal(gps[TAGS.GPS.GPSLongitude], gps[TAGS.GPS.GPSLongitudeRef]);
      if (lat !== null) gpsItems.push({ label: '纬度', value: `${lat.toFixed(6)}° ${gps[TAGS.GPS.GPSLatitudeRef] || ''}`, sensitive: true });
      if (lon !== null) gpsItems.push({ label: '经度', value: `${lon.toFixed(6)}° ${gps[TAGS.GPS.GPSLongitudeRef] || ''}`, sensitive: true });
      if (lat !== null && lon !== null) {
        gpsItems.push({ label: '坐标', value: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, sensitive: true });
      }
      this.pushTag(gpsItems, gps, TAGS.GPS.GPSAltitude, '海拔', true, (v) => Array.isArray(v) ? `${(v[0]/v[1]).toFixed(1)} m` : v);
      this.pushTag(gpsItems, gps, TAGS.GPS.GPSDateStamp, 'GPS 日期', true);
      this.pushTag(gpsItems, gps, TAGS.GPS.GPSTimeStamp, 'GPS 时间', true, this.formatGpsTime);
    }
    if (gpsItems.length) {
      groups.push({ name: '📍 位置信息（敏感）', items: gpsItems, isGps: true });
    }

    return groups;
  },

  pushTag(target, obj, tag, label, sensitive, formatter) {
    if (!obj || obj[tag] === undefined || obj[tag] === null) return;
    let v = obj[tag];
    if (formatter) {
      try { v = formatter(v); } catch (_) {}
    } else if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
      // 有理数 [num, den]
      v = (v[0] / v[1]).toString();
    } else if (typeof v === 'object') {
      v = JSON.stringify(v);
    }
    if (v === '' || v === undefined || v === null) return;
    target.push({ label, value: String(v), sensitive: !!sensitive });
  },

  formatFNumber(v) {
    if (Array.isArray(v)) return 'f/' + (v[0] / v[1]).toFixed(2);
    return 'f/' + v;
  },
  formatExposure(v) {
    if (Array.isArray(v)) {
      const sec = v[0] / v[1];
      if (sec >= 1) return sec.toFixed(2) + ' s';
      return `1/${Math.round(1 / sec)} s`;
    }
    return v + ' s';
  },
  formatFocal(v) {
    if (Array.isArray(v)) return (v[0] / v[1]).toFixed(2) + ' mm';
    return v + ' mm';
  },
  formatOrientation(v) {
    const map = { 1: '正常', 3: '旋转 180°', 6: '顺时针 90°', 8: '逆时针 90°' };
    return map[v] || ('代码 ' + v);
  },
  formatGpsTime(v) {
    if (!Array.isArray(v) || v.length < 3) return JSON.stringify(v);
    const h = Array.isArray(v[0]) ? v[0][0] / v[0][1] : v[0];
    const m = Array.isArray(v[1]) ? v[1][0] / v[1][1] : v[1];
    const s = Array.isArray(v[2]) ? v[2][0] / v[2][1] : v[2];
    return `${String(Math.floor(h)).padStart(2,'0')}:${String(Math.floor(m)).padStart(2,'0')}:${String(Math.floor(s)).padStart(2,'0')} UTC`;
  },

  // GPS 度分秒 -> 十进制
  dmsToDecimal(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 3) return null;
    const toNum = (x) => Array.isArray(x) ? x[0] / x[1] : x;
    const d = toNum(dms[0]);
    const m = toNum(dms[1]);
    const s = toNum(dms[2]);
    let v = d + m / 60 + s / 3600;
    if (ref === 'S' || ref === 'W') v = -v;
    return v;
  },

  // ============ 抹除 EXIF ============
  async stripExif() {
    if (!this.data.imageSrc || !this.data.isJpeg) return;
    const that = this;

    that.setData({ processing: true, processStep: '正在抹除元数据...' });
    wx.showLoading({ title: '抹除中...', mask: true });

    try {
      const base64 = await that.readAsBase64(that.data.imageSrc);
      const dataUrl = 'data:image/jpeg;base64,' + base64;

      // piexif.remove 直接产出无 EXIF 的 dataUrl
      const cleanedDataUrl = piexif.remove(dataUrl);
      const cleanedBase64 = cleanedDataUrl.split(',')[1];

      // 写入到本地临时路径
      const fs = wx.getFileSystemManager();
      const outPath = `${wx.env.USER_DATA_PATH}/exif_stripped_${Date.now()}.jpg`;
      await new Promise((resolve, reject) => {
        fs.writeFile({
          filePath: outPath,
          data: cleanedBase64,
          encoding: 'base64',
          success: resolve,
          fail: reject
        });
      });

      // 验证：再读一次确认没有 EXIF
      const reBase64 = await that.readAsBase64(outPath);
      const reExifObj = piexif.load('data:image/jpeg;base64,' + reBase64);
      const remainingTags = that.countTags(reExifObj);
      const verified = remainingTags === 0;

      const newSize = await that.getFileSize(outPath);

      that.setData({
        strippedPath: outPath,
        strippedSize: newSize,
        strippedSizeText: that.formatSize(newSize),
        strippedVerified: verified,
        verifyMessage: verified
          ? '✅ 验证通过：再次读取已无任何 EXIF 字段'
          : `⚠️ 仍有 ${remainingTags} 个字段残留`,
        processing: false,
        processStep: ''
      });
      analytics.track('tool_complete', { toolId: 'exif' });

      wx.hideLoading();
      wx.showToast({
        title: verified ? '元数据已清除' : '部分字段残留',
        icon: verified ? 'success' : 'none'
      });
    } catch (err) {
      wx.hideLoading();
      console.error('[exif] 抹除失败', err);
      that.setData({ processing: false, processStep: '' });
      wx.showModal({
        title: '抹除失败',
        content: err.message || '请确认文件格式为 JPEG',
        showCancel: false
      });
    }
  },

  saveStripped() {
    if (!this.data.strippedPath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.strippedPath,
      success() {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail(err) {
        if (err.errMsg && /auth deny|authorize/i.test(err.errMsg)) {
          wx.showModal({
            title: '需要相册权限',
            content: '请到设置中开启保存到相册的权限',
            success(r) {
              if (r.confirm) wx.openSetting();
            }
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  },

  previewStripped() {
    if (!this.data.strippedPath) return;
    wx.previewImage({
      urls: [this.data.strippedPath],
      current: this.data.strippedPath
    });
  },

  previewOriginal() {
    if (!this.data.imageSrc) return;
    wx.previewImage({
      urls: [this.data.imageSrc],
      current: this.data.imageSrc
    });
  },

  reset() {
    this.setData({
      imageSrc: '',
      imageInfo: null,
      imageSize: 0,
      imageSizeText: '',
      isJpeg: false,
      formatHint: '',
      hasExif: false,
      exifGroups: [],
      rawTagCount: 0,
      strippedPath: '',
      strippedSize: 0,
      strippedSizeText: '',
      strippedVerified: null,
      verifyMessage: ''
    });
  },

  // ============ 工具方法 ============
  readAsBase64(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success: (res) => resolve(res.data),
        fail: reject
      });
    });
  },

  getFileSize(filePath) {
    return new Promise((resolve) => {
      wx.getFileSystemManager().stat({
        path: filePath,
        success: (res) => resolve(res.stats.size || 0),
        fail: () => resolve(0)
      });
    });
  },

  formatSize(size) {
    if (!size) return '0 B';
    if (size > 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB';
    if (size > 1024) return (size / 1024).toFixed(1) + ' KB';
    return size + ' B';
  },

  onShareAppMessage() {
    analytics.trackShare('exif', 'friend');
    return {
      title: '查看/抹除图片 EXIF，一键清除 GPS 定位防隐私泄露',
      path: '/pages/exif/exif'
    };
  },

  onShareTimeline() {
    analytics.trackShare('exif', 'timeline');
    return { title: '一键抹除图片 GPS 等隐私信息' };
  }
});
