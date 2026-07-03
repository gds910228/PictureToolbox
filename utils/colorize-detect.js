// utils/colorize-detect.js
// 前端黑白/灰度检测：缩图采样 → 计算平均通道差（近似饱和度）。
// 用于「AI 老照片上色」入口，对非黑白图给出友好提示（不阻断，允许继续）。
//
// 判定（基于 0~255 通道差均值，阈值经验值）：
//   mean < 8   → 黑白/灰度（grayscale），适合上色
//   8 ~ 20     → 轻微色彩（可能是褪色老照片或低饱和图），仍可上色
//   > 20       → 彩色图片，提示「已有色彩，上色效果可能不明显」，允许继续

const { getImageInfo } = require('./image-process');

const SAMPLE_EDGE = 64;   // 采样缩图边长（越小越快，64 足以判定整体饱和度）
const TH_GRAY = 8;        // < 视为黑白/灰度
const TH_COLOR = 20;      // > 视为彩色

/**
 * 检测图片是否为黑白/灰度。
 * @param {string} filePath
 * @returns {Promise<{isGrayscale:boolean, isColor:boolean, mean:number, hint:string}>}
 */
function detectGrayscale(filePath) {
  return new Promise((resolve) => {
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;
      const sw = Math.max(1, Math.min(SAMPLE_EDGE, width));
      const sh = Math.max(1, Math.min(SAMPLE_EDGE, height));
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: sw, height: sh });
      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();
      image.onload = () => {
        try {
          ctx.drawImage(image, 0, 0, sw, sh);
          const imgData = ctx.getImageData(0, 0, sw, sh);
          const data = imgData.data;
          let sum = 0, count = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            sum += (max - min);
            count += 1;
          }
          const mean = count ? sum / count : 0;
          resolve(buildResult(mean));
        } catch (e) {
          console.warn('[colorize-detect] 取像素失败，按未知处理', e);
          resolve(buildResult(-1));
        }
      };
      image.onerror = () => {
        console.warn('[colorize-detect] 加载图片失败，按未知处理');
        resolve(buildResult(-1));
      };
      image.src = path;
    }).catch((e) => {
      console.warn('[colorize-detect] getImageInfo 失败，按未知处理', e);
      resolve(buildResult(-1));
    });
  });
}

function buildResult(mean) {
  if (mean < 0) {
    return { isGrayscale: false, isColor: false, mean: -1, hint: '' };
  }
  if (mean < TH_GRAY) {
    return { isGrayscale: true, isColor: false, mean, hint: '检测为黑白/灰度图，适合上色' };
  }
  if (mean > TH_COLOR) {
    return { isGrayscale: false, isColor: true, mean, hint: '图片似乎已有色彩，上色效果可能不明显' };
  }
  return { isGrayscale: false, isColor: false, mean, hint: '图片饱和度较低，可尝试上色' };
}

module.exports = { detectGrayscale };
