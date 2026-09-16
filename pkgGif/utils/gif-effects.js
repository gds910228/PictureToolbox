// utils/gif-effects.js
// 帧特效：发光描边、故障风、暗角。纯函数，无 wx/canvas 依赖，可 node 测试。
// 所有函数直接修改传入的 rgba 数组（in-place），返回变化包围盒。

'use strict';

/**
 * 发光描边：对亮度差异大的边缘像素叠加发光色。
 * 简化实现：检测与相邻像素的亮度差，超过阈值的像素向发光色偏移。
 * @param {Uint8Array} rgba 帧数据
 * @param {number} w
 * @param {number} h
 * @param {object} [opts] { color:[r,g,b], intensity:0-1, threshold:0-255 }
 * @returns {{x,y,w,h}|null}
 */
function glowEffect(rgba, w, h, opts) {
  opts = opts || {};
  var glowR = (opts.color && opts.color[0]) || 0;
  var glowG = (opts.color && opts.color[1]) || 240;
  var glowB = (opts.color && opts.color[2]) || 255;
  var intensity = opts.intensity !== undefined ? opts.intensity : 0.6;
  var threshold = opts.threshold !== undefined ? opts.threshold : 60;

  var src = new Uint8Array(rgba); // 副本用于读取原始值
  var minX = w, minY = h, maxX = -1, maxY = -1;

  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = (y * w + x) * 4;
      if (src[i + 3] < 128) continue;
      // 与右/下像素亮度差
      var lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      var right = i + 4;
      var below = i + w * 4;
      var lumR = 0.299 * src[right] + 0.587 * src[right + 1] + 0.114 * src[right + 2];
      var lumB = 0.299 * src[below] + 0.587 * src[below + 1] + 0.114 * src[below + 2];
      var edge = Math.abs(lum - lumR) + Math.abs(lum - lumB);
      if (edge > threshold * 2) {
        // 叠加发光色
        rgba[i] = Math.min(255, src[i] + glowR * intensity);
        rgba[i + 1] = Math.min(255, src[i + 1] + glowG * intensity);
        rgba[i + 2] = Math.min(255, src[i + 2] + glowB * intensity);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 故障风：随机通道偏移 + 水平撕裂条。
 * @param {Uint8Array} rgba
 * @param {number} w
 * @param {number} h
 * @param {object} [opts] { seed, intensity:0-1, sliceCount }
 * @returns {{x,y,w,h}|null}
 */
function glitchEffect(rgba, w, h, opts) {
  opts = opts || {};
  var intensity = opts.intensity !== undefined ? opts.intensity : 0.5;
  var rng = makeRng(opts.seed || 12345);
  var changed = false;

  // 1. RGB 通道偏移
  var shiftR = Math.round((rng() - 0.5) * intensity * 8);
  var shiftB = Math.round((rng() - 0.5) * intensity * 8);
  if (shiftR !== 0 || shiftB !== 0) {
    var src = new Uint8Array(rgba);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (src[i + 3] < 128) continue;
        // R 通道水平偏移
        var sr = x + shiftR;
        if (sr >= 0 && sr < w) {
          rgba[i] = src[(y * w + sr) * 4];
        }
        // B 通道水平偏移
        var sb = x + shiftB;
        if (sb >= 0 && sb < w) {
          rgba[i + 2] = src[(y * w + sb) * 4 + 2];
        }
      }
    }
    changed = true;
  }

  // 2. 水平撕裂条（随机行左右位移）
  var sliceCount = opts.sliceCount || Math.round(3 + intensity * 6);
  for (var s = 0; s < sliceCount; s++) {
    var sliceY = Math.floor(rng() * h);
    var sliceH = Math.max(1, Math.floor(rng() * intensity * h * 0.15));
    var dx = Math.round((rng() - 0.5) * w * 0.2 * intensity);
    for (var yy = sliceY; yy < Math.min(h, sliceY + sliceH); yy++) {
      var rowStart = yy * w * 4;
      var rowCopy = new Uint8Array(w * 4);
      // 先复制原始行（保持越界像素不变）
      rowCopy.set(rgba.subarray(rowStart, rowStart + w * 4));
      for (var xx = 0; xx < w; xx++) {
        var srcX = xx - dx;
        if (srcX >= 0 && srcX < w) {
          rowCopy[xx * 4] = rgba[rowStart + srcX * 4];
          rowCopy[xx * 4 + 1] = rgba[rowStart + srcX * 4 + 1];
          rowCopy[xx * 4 + 2] = rgba[rowStart + srcX * 4 + 2];
          rowCopy[xx * 4 + 3] = rgba[rowStart + srcX * 4 + 3];
        }
      }
      rgba.set(rowCopy, rowStart);
    }
    changed = true;
  }

  if (!changed) return null;
  return { x: 0, y: 0, w: w, h: h };
}

/**
 * 暗角：边缘像素变暗（径向渐变）。
 * @param {Uint8Array} rgba
 * @param {number} w
 * @param {number} h
 * @param {object} [opts] { intensity:0-1, radius:0-1 }
 * @returns {{x,y,w,h}}
 */
function vignetteEffect(rgba, w, h, opts) {
  opts = opts || {};
  var intensity = opts.intensity !== undefined ? opts.intensity : 0.5;
  var radius = opts.radius !== undefined ? opts.radius : 0.75;
  var cx = w / 2, cy = h / 2;
  var maxDist = Math.sqrt(cx * cx + cy * cy);
  var innerR = maxDist * radius;

  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      if (rgba[i + 3] < 128) continue;
      var dx = x - cx, dy = y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > innerR) {
        var t = Math.min(1, (dist - innerR) / (maxDist - innerR));
        var factor = 1 - t * intensity;
        rgba[i] = Math.round(rgba[i] * factor);
        rgba[i + 1] = Math.round(rgba[i + 1] * factor);
        rgba[i + 2] = Math.round(rgba[i + 2] * factor);
      }
    }
  }
  return { x: 0, y: 0, w: w, h: h };
}

/**
 * 淡入淡出：根据帧在区间中的位置调整 alpha。
 * @param {Uint8Array} rgba
 * @param {number} w
 * @param {number} h
 * @param {number} frameIdx 当前帧索引（区间内）
 * @param {number} fadeStart 淡入帧数
 * @param {number} fadeEnd 淡出帧数
 * @param {number} totalInRange 区间总帧数
 * @returns {{x,y,w,h}}
 */
function fadeFrame(rgba, w, h, frameIdx, fadeStart, fadeEnd, totalInRange) {
  var alpha = 1;
  if (frameIdx < fadeStart) {
    alpha = (frameIdx + 1) / fadeStart;
  } else if (frameIdx >= totalInRange - fadeEnd) {
    alpha = (totalInRange - frameIdx) / fadeEnd;
  }
  alpha = Math.max(0, Math.min(1, alpha));
  if (alpha >= 1) return { x: 0, y: 0, w: w, h: h };

  for (var i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 0) {
      rgba[i] = Math.round(rgba[i] * alpha);
    }
  }
  return { x: 0, y: 0, w: w, h: h };
}

// 简单种子化 PRNG
function makeRng(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  glowEffect: glowEffect,
  glitchEffect: glitchEffect,
  vignetteEffect: vignetteEffect,
  fadeFrame: fadeFrame
};
