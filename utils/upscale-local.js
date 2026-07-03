// utils/upscale-local.js - AI 放大本地的降级与预处理工具
//
// 提供：
//   ensureBounded  - 把原图最长边限制到 maxEdge（避免超大图内存问题 / 满足 Real-ESRGAN ≤1440p 建议）
//   enhanceImage   - 本地基础增强：降噪(轻度模糊) + 锐化(3×3 卷积)，作用于放大前的原图
//   localUpscale   - 本地基础放大（Canvas 平滑缩放，非 AI），用于云端不可用时的降级
//
// 说明：降噪/锐化为本地 Canvas 实现，是「基础增强」；AI 放大质量由云端 Real-ESRGAN 决定，
// 本工具不虚构任何第三方 API 能力。

const { getImageInfo } = require('./image-process');

/**
 * 限制原图最长边。若已 ≤ maxEdge，原样返回；否则等比缩小到 maxEdge。
 * @returns {Promise<{path:string,width:number,height:number,bounded:boolean}>}
 */
function ensureBounded(filePath, maxEdge = 1440) {
  return new Promise((resolve, reject) => {
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;
      const longest = Math.max(width, height);
      if (longest <= maxEdge) {
        resolve({ path: filePath, width, height, bounded: false });
        return;
      }
      const scale = maxEdge / longest;
      const tw = Math.max(1, Math.round(width * scale));
      const th = Math.max(1, Math.round(height * scale));

      const canvas = wx.createOffscreenCanvas({ type: '2d', width: tw, height: th });
      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();
      image.onload = () => {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, tw, th);
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'jpg',
          quality: 0.92,
          success: (res) => resolve({ path: res.tempFilePath, width: tw, height: th, bounded: true }),
          fail: (err) => reject(err)
        });
      };
      image.onerror = (err) => reject(err);
      image.src = path;
    }).catch(reject);
  });
}

/**
 * 本地基础增强：先降噪(轻度模糊)，再锐化(3×3 卷积)。
 * 任一关闭则跳过对应步骤。
 * @param {string} filePath
 * @param {{denoise?:boolean, sharpen?:boolean}} opts
 * @returns {Promise<string>} 处理后临时路径
 */
function enhanceImage(filePath, opts = {}) {
  return new Promise((resolve, reject) => {
    const denoise = !!opts.denoise;
    const sharpen = !!opts.sharpen;
    if (!denoise && !sharpen) {
      resolve(filePath);
      return;
    }
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;
      const canvas = wx.createOffscreenCanvas({ type: '2d', width, height });
      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();
      image.onload = () => {
        // 1) 绘制原图
        ctx.drawImage(image, 0, 0, width, height);

        // 2) 降噪：轻度模糊（用 CSS filter，平台实现，速度快）
        if (denoise) {
          ctx.clearRect(0, 0, width, height);
          ctx.filter = 'blur(0.6px) brightness(1.02)';
          ctx.drawImage(image, 0, 0, width, height);
          ctx.filter = 'none';
        }

        // 3) 锐化：3×3 卷积（仅在小图上做，避免超大图内存/性能问题）
        if (sharpen) {
          // 超过 2400×2400 跳过锐化（已 ensureBounded 限制到 ≤1440p，正常不会触发）
          if (width * height > 2400 * 2400) {
            console.warn('[upscale-local] 图片过大，跳过本地锐化');
          } else {
            applySharpenConvolution(ctx, width, height);
          }
        }

        wx.canvasToTempFilePath({
          canvas,
          fileType: 'jpg',
          quality: 0.95,
          success: (res) => resolve(res.tempFilePath),
          fail: (err) => reject(err)
        });
      };
      image.onerror = (err) => reject(err);
      image.src = path;
    }).catch(reject);
  });
}

// 3×3 锐化卷积核 [[0,-1,0],[-1,5,-1],[0,-1,0]]，原地修改
function applySharpenConvolution(ctx, w, h) {
  let src;
  try {
    src = ctx.getImageData(0, 0, w, h);
  } catch (e) {
    console.warn('[upscale-local] getImageData 失败，跳过锐化', e);
    return;
  }
  const data = src.data;
  const out = new Uint8ClampedArray(data.length);
  // 复制 alpha
  for (let i = 3; i < data.length; i += 4) out[i] = data[i];

  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const px = Math.min(w - 1, Math.max(0, x + kx));
          const py = Math.min(h - 1, Math.max(0, y + ky));
          const idx = (py * w + px) * 4;
          const k = kernel[ki++];
          r += data[idx] * k;
          g += data[idx + 1] * k;
          b += data[idx + 2] * k;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = out[i];
  ctx.putImageData(src, 0, 0);
}

/**
 * 本地基础放大：Canvas 平滑缩放（平台双线性）。非 AI，效果弱于 Real-ESRGAN。
 * @param {string} filePath
 * @param {number} scale 2|4
 * @returns {Promise<string>}
 */
function localUpscale(filePath, scale = 2) {
  return new Promise((resolve, reject) => {
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;
      const tw = Math.max(1, Math.round(width * scale));
      const th = Math.max(1, Math.round(height * scale));

      const canvas = wx.createOffscreenCanvas({ type: '2d', width: tw, height: th });
      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();
      image.onload = () => {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, tw, th);
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'jpg',
          quality: 0.95,
          success: (res) => resolve(res.tempFilePath),
          fail: (err) => reject(err)
        });
      };
      image.onerror = (err) => reject(err);
      image.src = path;
    }).catch(reject);
  });
}

module.exports = {
  ensureBounded,
  enhanceImage,
  localUpscale
};
