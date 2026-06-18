// utils/compare-helper.js - 图片对比查看器跳转工具
//
// 提供统一的「对比查看」入口：暂存待对比的两张图片路径与配置，
// 然后跳转到 pages/compare/compare 页面；页面 onLoad 时通过
// consumePendingCompare() 取出并清空。
//
// 之所以用模块级变量而不是 URL query：图片路径可能是本地 wxfile://、
// 云端 cloud:// 或 https 临时 URL，长度/字符不适合放进 navigateTo 的 query。

let _pendingCompare = null;

/**
 * 跳转到对比查看页面
 * @param {string} originalPath  原图路径（本地/cloud:///https）
 * @param {string} processedPath 处理后图片路径（本地/cloud:///https）
 * @param {object} [options]
 *   - mode {'slide'|'toggle'} 默认 'slide'（滑动对比）
 *   - title {string}          页面标题（如「压缩对比」）
 *   - showInfo {boolean}      是否显示信息栏，默认 false
 *   - originalLabel {string}  原图标注，默认「原图」
 *   - processedLabel {string} 处理后标注，默认「处理后」
 */
function navigateToCompare(originalPath, processedPath, options = {}) {
  if (!originalPath || !processedPath) {
    wx.showToast({
      title: '缺少对比图片',
      icon: 'none'
    });
    return false;
  }

  _pendingCompare = {
    originalPath: originalPath,
    processedPath: processedPath,
    options: {
      mode: options.mode === 'toggle' ? 'toggle' : 'slide',
      title: options.title || '对比查看',
      showInfo: !!options.showInfo,
      originalLabel: options.originalLabel || '原图',
      processedLabel: options.processedLabel || '处理后'
    }
  };

  wx.navigateTo({
    url: '/pages/compare/compare',
    fail(err) {
      console.error('跳转对比页面失败', err);
      _pendingCompare = null;
      wx.showToast({
        title: '打开对比页失败',
        icon: 'none'
      });
    }
  });

  return true;
}

/**
 * 取出（并清空）待对比数据，供 compare 页面 onLoad 调用
 * @returns {object|null}
 */
function consumePendingCompare() {
  const data = _pendingCompare;
  _pendingCompare = null;
  return data;
}

/**
 * 判断是否为需要下载的远程路径
 */
function _isRemotePath(path) {
  return typeof path === 'string' && /^(https?:|cloud:|wxfile-cloud:)/i.test(path);
}

/**
 * 把单张图片下载到本地临时文件（cloud:// / http(s)://），
 * 已是本地路径则原样返回。
 */
function _toLocalPath(path) {
  return new Promise((resolve, reject) => {
    if (!_isRemotePath(path)) {
      resolve(path);
      return;
    }

    const isCloud = /^cloud:/i.test(path);

    const done = (res) => {
      if (res && res.tempFilePath) {
        resolve(res.tempFilePath);
      } else {
        // 下载未返回有效路径：回退用原路径（可能是开发者工具的本地临时 http://tmp 路径）
        resolve(path);
      }
    };

    const fail = (err) => {
      // 下载失败时回退到原路径：
      // - 开发者工具的 http://tmp 本地临时路径 downloadFile 会失败，但可直接绘制
      // - 切换模式的 <image> 可直接显示 https/cloud，滑动模式会在预加载时优雅报错
      console.warn('下载对比图片失败，回退原路径', path, err);
      resolve(path);
    };

    if (isCloud) {
      if (!wx.cloud || !wx.cloud.downloadFile) {
        resolve(path);
        return;
      }
      wx.cloud.downloadFile({ fileID: path, success: done, fail: fail });
    } else {
      wx.downloadFile({ url: path, success: done, fail: fail });
    }
  });
}

/**
 * 批量归一化图片路径：将 cloud:// / http(s):// 下载到本地，
 * 返回与输入顺序一致的本地路径数组。
 * @param {string[]} paths
 * @returns {Promise<string[]>}
 */
function normalizeImagePaths(paths) {
  return Promise.all(paths.map((p) => _toLocalPath(p)));
}

module.exports = {
  navigateToCompare,
  consumePendingCompare,
  normalizeImagePaths
};
