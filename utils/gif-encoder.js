// utils/gif-encoder.js
// 自包含 GIF89a 编码器（无依赖、无 Worker），面向微信小程序。
//
// 策略：固定 6x6x6=216 色统一全局色板（+40 黑填充到 256）+ 可选 Floyd-Steinberg 抖动 + LZW。
// 选统一色板而非自适应（median-cut/NeuQuant）：映射 O(1)、无跨帧协调、低风险、可流式逐帧编码，
// 适配"首版小尺寸多图稳定生成"。质量为"可用"级别（照片略带色阶），后续可换 NeuQuant 提升。
//
// 正确性已用口碑库 omggif（严格 GIF 解码器）交叉验证：
//   - NETSCAPE2.0 应用标识必须恰好 11 字节（曾误写成 "NETSCAPIME2.0" 导致整文件错位）
//   - LZW 码宽在"下一个待分配码达到 2^width"时递增；post-increment 写法是 `nextCode > (1<<w)`
//     （用 `===` 会早一拍递增，使首条边界后所有码多发一位，解码出垃圾）

'use strict';

// 延迟加载 color-quantize（避免在不需要自适应调色板时引入额外开销）
var _medianCut = null;
function getMedianCut() {
  if (!_medianCut) {
    // 在微信小程序和 node 中都能 require
    _medianCut = require('./color-quantize.js').medianCut;
  }
  return _medianCut;
}

var LEVELS = 6;                  // 每通道色阶数
var STEP = 255 / (LEVELS - 1);  // 51
var PALETTE_BITS = 8;            // 2^8 = 256 色表项 -> LZW min code size = 8

var PALETTE = (function () {
  var p = [];
  for (var r = 0; r < LEVELS; r++)
    for (var g = 0; g < LEVELS; g++)
      for (var b = 0; b < LEVELS; b++)
        p.push([Math.round(r * STEP), Math.round(g * STEP), Math.round(b * STEP)]);
  while (p.length < 256) p.push([0, 0, 0]); // 补齐到 256
  return p;
})();

// 单个 rgb 贴到最近色板索引（无抖动，O(1)）
function nearestIndex(r, g, b) {
  var ri = Math.max(0, Math.min(LEVELS - 1, Math.round(r / STEP)));
  var gi = Math.max(0, Math.min(LEVELS - 1, Math.round(g / STEP)));
  var bi = Math.max(0, Math.min(LEVELS - 1, Math.round(b / STEP)));
  return (ri * LEVELS + gi) * LEVELS + bi;
}

// Floyd-Steinberg 误差扩散抖动，贴到统一色板
function ditherQuantize(rgba, indices, width, height) {
  var n = width * height;
  var r = new Float32Array(n);
  var g = new Float32Array(n);
  var b = new Float32Array(n);
  for (var i = 0, p = 0; i < n; i++, p += 4) {
    r[i] = rgba[p]; g[i] = rgba[p + 1]; b[i] = rgba[p + 2];
  }
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var idx = y * width + x;
      var ri = Math.max(0, Math.min(LEVELS - 1, Math.round(r[idx] / STEP)));
      var gi = Math.max(0, Math.min(LEVELS - 1, Math.round(g[idx] / STEP)));
      var bi = Math.max(0, Math.min(LEVELS - 1, Math.round(b[idx] / STEP)));
      indices[idx] = (ri * LEVELS + gi) * LEVELS + bi;
      var er = r[idx] - ri * STEP;
      var eg = g[idx] - gi * STEP;
      var eb = b[idx] - bi * STEP;
      if (x + 1 < width) {
        var j = idx + 1;
        r[j] += er * 7 / 16; g[j] += eg * 7 / 16; b[j] += eb * 7 / 16;
      }
      if (y + 1 < height) {
        if (x - 1 >= 0) {
          var j1 = idx + width - 1;
          r[j1] += er * 3 / 16; g[j1] += eg * 3 / 16; b[j1] += eb * 3 / 16;
        }
        var j2 = idx + width;
        r[j2] += er * 5 / 16; g[j2] += eg * 5 / 16; b[j2] += eb * 5 / 16;
        if (x + 1 < width) {
          var j3 = idx + width + 1;
          r[j3] += er * 1 / 16; g[j3] += eg * 1 / 16; b[j3] += eb * 1 / 16;
        }
      }
    }
  }
}

// LZW 编码色板索引（minCodeSize=8）。返回字节数组。
function lzwEncode(indices, minCodeSize) {
  var clearCode = 1 << minCodeSize;
  var eoiCode = clearCode + 1;
  var nextCode = eoiCode + 1;
  var codeSize = minCodeSize + 1;
  var dict = {};

  var out = [];
  var cur = 0, curBits = 0;
  function writeCode(code) {
    cur |= (code << curBits);
    curBits += codeSize;
    while (curBits >= 8) {
      out.push(cur & 0xff);
      cur >>>= 8;
      curBits -= 8;
    }
  }

  writeCode(clearCode);
  var phrase = indices[0];
  for (var i = 1; i < indices.length; i++) {
    var c = indices[i];
    var key = (phrase << 8) | c;       // phrase<4096, c<256 -> 20-bit，唯一
    var found = dict[key];
    if (found !== undefined) {
      phrase = found;
    } else {
      writeCode(phrase);
      if (nextCode < 4096) {
        dict[key] = nextCode;
        nextCode++;
        // 码宽在"下一个待分配码达到 2^width"时递增。
        // omggif 权威写法是 pre-assign `next_code >= (1<<w)`；post-increment 等价为 `nextCode > (1<<w)`。
        // 切勿用 `===`（会早一拍，破坏整个码流）。
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        writeCode(clearCode);
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
        dict = {};
      }
      phrase = c;
    }
  }
  writeCode(phrase);
  writeCode(eoiCode);
  if (curBits > 0) out.push(cur & 0xff);
  return out;
}

// frames: [{ width, height, rgba: Uint8Array(宽*高*4), delayCs }]
// opts:   { width, height, loop (0=无限, null=单次), dither (bool) }
function buildGIF(frames, opts) {
  var width = opts.width;
  var height = opts.height;
  var loop = opts.loop;            // 0 -> 无限；null -> 不输出 NETSCAPE（播一次）
  var dither = opts.dither !== false;
  var bytes = [];

  function u16(v) { bytes.push(v & 0xff, (v >> 8) & 0xff); }
  function raw(arr) { for (var k = 0; k < arr.length; k++) bytes.push(arr[k]); }

  raw([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  u16(width); u16(height);
  bytes.push(0xF7); // GCT 标志=1, 颜色分辨率=7, 排序=0, GCT 大小=7 -> 256 项
  bytes.push(0);     // 背景色索引
  bytes.push(0);     // 像素纵横比
  for (var i = 0; i < 256; i++) {
    bytes.push(PALETTE[i][0], PALETTE[i][1], PALETTE[i][2]);
  }

  if (loop !== null) {
    raw([0x21, 0xFF, 0x0B]);
    // "NETSCAPE2.0" 恰好 11 字节，多写一个字符都会让整文件错位
    raw([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]);
    bytes.push(0x03, 0x01);
    u16(loop & 0xffff);
    bytes.push(0x00);
  }

  for (var f = 0; f < frames.length; f++) {
    var frame = frames[f];
    var rgba = frame.rgba;
    var indices = new Uint8Array(width * height);
    if (dither) {
      ditherQuantize(rgba, indices, width, height);
    } else {
      for (var p = 0, ii = 0; p < rgba.length; p += 4, ii++) {
        indices[ii] = nearestIndex(rgba[p], rgba[p + 1], rgba[p + 2]);
      }
    }

    raw([0x21, 0xF9, 0x04]);      // 图形控制扩展
    bytes.push(0x00);             // disposal=0，无透明
    u16(frame.delayCs || 10);
    bytes.push(0x00, 0x00);

    bytes.push(0x2C);             // 图像分隔符
    u16(0); u16(0); u16(width); u16(height);
    bytes.push(0x00);             // 无局部色板，非隔行

    bytes.push(PALETTE_BITS);     // LZW min code size
    var lzw = lzwEncode(indices, PALETTE_BITS);
    var pos = 0;
    while (pos < lzw.length) {
      var len = Math.min(255, lzw.length - pos);
      bytes.push(len);
      for (var k = 0; k < len; k++) bytes.push(lzw[pos + k]);
      pos += len;
    }
    bytes.push(0x00);             // 块终止符
  }

  bytes.push(0x3B);               // 文件尾
  return new Uint8Array(bytes);
}

// 差量编码：对比相邻合成帧，仅编码变化矩形（dirty-rect），不变像素用透明索引跳过。
// frames: [{ width, height, rgba: Uint8Array(W*H*4), delayCs }] —— 必须是合成后的完整帧
// opts:   { width, height, loop (0=无限, null=单次), dither (bool, 默认 false) }
//
// 策略（两遍）：
//   第一遍：计算每帧是否有"擦除"（前帧不透明→当前帧透明，alpha 255→0）。
//   擦除意味着前一帧必须用 disposal=2（显示后清空画布），当前帧从空画布开始全帧绘制。
//
//   第二遍：逐帧编码：
//   - 色板索引 255 保留为透明索引（nearestIndex 永不返回 >215）
//   - 若画布已清空（首帧或前帧 disposal=2）：全帧编码，alpha=0 像素用透明索引
//   - 若画布保留且无擦除：求变化包围盒（dirty-rect），盒内不变像素用透明索引
//   - 若无变化：编码 1×1 透明像素以保留帧延时
//   - 当前帧的 disposal 由"下一帧是否有擦除"决定（最后一帧用 disposal=1）
//   - 默认关闭抖动（避免误差跨越 dirty-rect 边界产生伪影）
function buildGIFDiff(frames, opts) {
  var width = opts.width;
  var height = opts.height;
  var loop = opts.loop;
  var dither = opts.dither === true;
  var TRANS_INDEX = 255;
  var n = frames.length;

  var bytes = [];
  function u16(v) { bytes.push(v & 0xff, (v >> 8) & 0xff); }
  function raw(arr) { for (var k = 0; k < arr.length; k++) bytes.push(arr[k]); }

  // ---- 第一遍：检测擦除 ----
  // erasure[f] = true 表示帧 f 相对帧 f-1 有 alpha 255→0 的像素
  // 这意味着帧 f-1 必须用 disposal=2
  var erasure = new Array(n);
  erasure[0] = false;
  for (var f = 1; f < n; f++) {
    erasure[f] = hasErasure(frames[f - 1].rgba, frames[f].rgba, width, height);
  }

  // ---- 文件头 + GCT ----
  raw([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  u16(width); u16(height);
  bytes.push(0xF7);
  bytes.push(0);
  bytes.push(0);
  for (var i = 0; i < 256; i++) {
    bytes.push(PALETTE[i][0], PALETTE[i][1], PALETTE[i][2]);
  }

  if (loop !== null) {
    raw([0x21, 0xFF, 0x0B]);
    raw([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]);
    bytes.push(0x03, 0x01);
    u16(loop & 0xffff);
    bytes.push(0x00);
  }

  // ---- 第二遍：逐帧编码 ----
  // canvasCleared: 上一帧使用 disposal=2，画布已清空，当前帧必须全帧
  var canvasCleared = true;
  var prevRgba = null;

  for (var f2 = 0; f2 < n; f2++) {
    var frame = frames[f2];
    var rgba = frame.rgba;
    var delayCs = frame.delayCs || 10;

    var rectX, rectY, rectW, rectH, indices, hasTransparency;

    // 当前帧是否需要 disposal=2（由下一帧是否有擦除决定，最后一帧不需要）
    // disposal=2 会在显示后清空"当前帧矩形区域"，因此需要清空整画布时必须全帧编码
    var useDisposal2 = f2 < n - 1 && erasure[f2 + 1];

    if (canvasCleared || useDisposal2) {
      // 画布已清空，或当前帧需要 disposal=2（必须全帧以清空整画布）：全帧绘制
      rectX = 0; rectY = 0; rectW = width; rectH = height;
      indices = new Uint8Array(width * height);
      hasTransparency = quantizeFull(rgba, indices, width, height, dither, TRANS_INDEX);
    } else {
      // 画布保留：求变化包围盒
      var bbox = findDirtyRect(prevRgba, rgba, width, height);
      if (!bbox) {
        // 无变化：1×1 透明像素保留延时
        rectX = 0; rectY = 0; rectW = 1; rectH = 1;
        indices = new Uint8Array(1);
        indices[0] = TRANS_INDEX;
        hasTransparency = true;
      } else {
        // 差量编码：仅 dirty rect
        rectX = bbox.x; rectY = bbox.y; rectW = bbox.w; rectH = bbox.h;
        indices = new Uint8Array(rectW * rectH);
        quantizeDiff(rgba, prevRgba, indices, width, height,
                     rectX, rectY, rectW, rectH, TRANS_INDEX);
        hasTransparency = true;
      }
    }

    // GCE
    raw([0x21, 0xF9, 0x04]);
    var gcePacked = (useDisposal2 ? 2 : 1) << 2;
    if (hasTransparency) gcePacked |= 0x01;
    bytes.push(gcePacked);
    u16(delayCs);
    bytes.push(hasTransparency ? TRANS_INDEX : 0);
    bytes.push(0x00);

    // Image Descriptor
    bytes.push(0x2C);
    u16(rectX); u16(rectY); u16(rectW); u16(rectH);
    bytes.push(0x00);

    // LZW
    bytes.push(PALETTE_BITS);
    var lzw = lzwEncode(indices, PALETTE_BITS);
    var pos = 0;
    while (pos < lzw.length) {
      var len = Math.min(255, lzw.length - pos);
      bytes.push(len);
      for (var k = 0; k < len; k++) bytes.push(lzw[pos + k]);
      pos += len;
    }
    bytes.push(0x00);

    prevRgba = rgba;
    canvasCleared = useDisposal2;
  }

  bytes.push(0x3B);
  return new Uint8Array(bytes);
}

// 全帧量化。alpha=0 → 透明索引；否则量化到色板。返回是否使用了透明索引。
function quantizeFull(rgba, indices, w, h, dither, transIndex) {
  var hasTrans = false;
  if (dither) {
    // 抖动路径：先全帧抖动，再把 alpha=0 的像素覆盖为透明索引
    ditherQuantize(rgba, indices, w, h);
    for (var i = 0, p = 0; i < w * h; i++, p += 4) {
      if (rgba[p + 3] === 0) {
        indices[i] = transIndex;
        hasTrans = true;
      }
    }
    return hasTrans;
  }
  for (var i2 = 0, p2 = 0; i2 < w * h; i2++, p2 += 4) {
    if (rgba[p2 + 3] === 0) {
      indices[i2] = transIndex;
      hasTrans = true;
    } else {
      indices[i2] = nearestIndex(rgba[p2], rgba[p2 + 1], rgba[p2 + 2]);
    }
  }
  return hasTrans;
}

// 差量矩形量化：与前帧相同→透明索引；alpha=0→透明索引；否则量化。
function quantizeDiff(rgba, prev, indices, fullW, fullH, rx, ry, rw, rh, transIndex) {
  for (var y = 0; y < rh; y++) {
    var sy = ry + y;
    for (var x = 0; x < rw; x++) {
      var sx = rx + x;
      var si = (sy * fullW + sx) * 4;
      var di = y * rw + x;
      // 透明像素（alpha=0）或与前帧完全相同的像素 → 透明索引
      if (rgba[si + 3] === 0 ||
          (rgba[si] === prev[si] && rgba[si + 1] === prev[si + 1] &&
           rgba[si + 2] === prev[si + 2] && rgba[si + 3] === prev[si + 3])) {
        indices[di] = transIndex;
      } else {
        indices[di] = nearestIndex(rgba[si], rgba[si + 1], rgba[si + 2]);
      }
    }
  }
}

// 检查是否存在"擦除"（前帧 alpha=255 → 当前帧 alpha=0）
function hasErasure(prev, cur, w, h) {
  if (!prev) return false;
  for (var i = 3; i < w * h * 4; i += 4) {
    if (prev[i] === 255 && cur[i] === 0) return true;
  }
  return false;
}

// 逐像素比较两帧，返回变化区域包围盒 {x,y,w,h}，无变化返回 null
function findDirtyRect(prev, cur, w, h) {
  var minX = w, minY = h, maxX = -1, maxY = -1;
  var p = 0;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (cur[p] !== prev[p] || cur[p + 1] !== prev[p + 1] ||
          cur[p + 2] !== prev[p + 2] || cur[p + 3] !== prev[p + 3]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      p += 4;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ===================================================================
// 自适应调色板编码
// ===================================================================

// 加权色彩距离平方（与 color-quantize.js 的 colorDist2 一致，内联以避免依赖）
function _colorDist2(r1, g1, b1, r2, g2, b2) {
  var rmean = (r1 + r2) / 2;
  var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db;
}

/**
 * 从多帧 RGBA 数据收集像素，用 medianCut 生成自适应调色板。
 * @param {Array} frames [{rgba,...}]
 * @param {number} maxColors 最大颜色数（不含透明槽），默认 255
 * @returns {{colors:Array<[r,g,b]>, transIndex:number, tableSize:number, minCodeSize:number}}
 */
function buildAdaptivePalette(frames, maxColors) {
  maxColors = maxColors || 255;
  var medianCut = getMedianCut();

  // 收集所有不透明像素（降采样以加速：大图像每隔几个像素取一个）
  var samples = [];
  var totalPixels = 0;
  for (var f = 0; f < frames.length; f++) {
    var rgba = frames[f].rgba;
    totalPixels += rgba.length / 4;
  }
  // 采样步长：目标约 50000 个采样点
  var step = Math.max(1, Math.floor(totalPixels / 50000));
  for (var f2 = 0; f2 < frames.length; f2++) {
    var rgba2 = frames[f2].rgba;
    for (var i = 0; i < rgba2.length; i += 4 * step) {
      if (rgba2[i + 3] >= 128) {
        samples.push(rgba2[i], rgba2[i + 1], rgba2[i + 2], 255);
      }
    }
  }

  var rawColors = medianCut(samples, maxColors);
  // 补齐到 2 的幂（GIF 调色板大小必须是 2 的幂，最小 4），保留 1 个透明槽
  var numColors = rawColors.length;
  var minCodeSize = 2;
  var tableSize = 4; // 1 << 2，GIF 最小调色板
  while (tableSize < numColors + 1) { // +1 for transparent
    minCodeSize++;
    tableSize = 1 << minCodeSize;
  }
  if (tableSize > 256) {
    tableSize = 256;
    minCodeSize = 8;
  }
  var transIndex = tableSize - 1; // 最后一个槽位为透明

  var colors = new Array(tableSize);
  for (var c = 0; c < tableSize; c++) {
    if (c < numColors) {
      colors[c] = [rawColors[c].r, rawColors[c].g, rawColors[c].b];
    } else {
      // 填充：用第一个颜色或黑色
      colors[c] = c === transIndex ? [0, 0, 0] : (colors[0] || [0, 0, 0]);
    }
  }
  // 确保透明槽位是黑色（实际不会显示）
  colors[transIndex] = [0, 0, 0];

  return { colors: colors, transIndex: transIndex, tableSize: tableSize, minCodeSize: minCodeSize };
}

/**
 * 构建 3D 查找网格，加速最近色查找。
 * 网格分辨率 32×32×32（5 bits/通道），内存 32KB。
 * @param {Array<[r,g,b]>} palette
 * @returns {Uint8Array} 长度 32768 的调色板索引数组
 */
function buildLookupGrid(palette) {
  var BITS = 5;
  var SIZE = 1 << BITS; // 32
  var grid = new Uint8Array(SIZE * SIZE * SIZE);
  var shift = 8 - BITS; // 3
  for (var gy = 0; gy < SIZE; gy++) {
    for (var gx = 0; gx < SIZE; gx++) {
      for (var gz = 0; gz < SIZE; gz++) {
        var r = (gx << shift) | (shift >> 1); // 格中心
        var g = (gy << shift) | (shift >> 1);
        var b = (gz << shift) | (shift >> 1);
        var best = 0, bestDist = Infinity;
        for (var p = 0; p < palette.length; p++) {
          var d = _colorDist2(r, g, b, palette[p][0], palette[p][1], palette[p][2]);
          if (d < bestDist) { bestDist = d; best = p; }
        }
        grid[(gy * SIZE + gx) * SIZE + gz] = best;
      }
    }
  }
  return grid;
}

/**
 * 用自适应调色板量化一帧 RGBA 到索引数组。
 * @param {Uint8Array} rgba 帧数据
 * @param {number} w
 * @param {number} h
 * @param {Array} palette 调色板 [[r,g,b],...]
 * @param {Uint8Array} grid 3D 查找网格
 * @param {number} transIndex 透明索引
 * @param {Uint8Array} [prevRgba] 前一帧（差量编码时用于透明跳过）
 * @returns {Uint8Array} 索引数组
 */
function quantizeAdaptive(rgba, w, h, palette, grid, transIndex, prevRgba) {
  var n = w * h;
  var indices = new Uint8Array(n);
  var BITS = 5;
  var shift = 8 - BITS;
  for (var i = 0; i < n; i++) {
    var p = i * 4;
    if (rgba[p + 3] < 128) {
      indices[i] = transIndex;
      continue;
    }
    if (prevRgba &&
        rgba[p] === prevRgba[p] && rgba[p + 1] === prevRgba[p + 1] &&
        rgba[p + 2] === prevRgba[p + 2] && rgba[p + 3] === prevRgba[p + 3]) {
      indices[i] = transIndex;
      continue;
    }
    var gi = ((rgba[p + 1] >> shift) << (BITS * 2)) | ((rgba[p] >> shift) << BITS) | (rgba[p + 2] >> shift);
    indices[i] = grid[gi];
  }
  return indices;
}

/**
 * 自适应调色板全帧编码（每帧全帧，使用全局自适应调色板）。
 * 接口与 buildGIF 相同，额外 opts.adaptive = true。
 */
function buildGIFAdaptive(frames, opts) {
  opts = opts || {};
  var width = opts.width, height = opts.height;
  var loop = opts.loop !== undefined ? opts.loop : 0;
  var paletteInfo = buildAdaptivePalette(frames, 255);
  var grid = buildLookupGrid(paletteInfo.colors);
  var minCodeSize = paletteInfo.minCodeSize;
  var transIndex = paletteInfo.transIndex;

  var bytes = [];
  function u16(v) { bytes.push(v & 0xff, (v >> 8) & 0xff); }
  function raw(arr) { for (var k = 0; k < arr.length; k++) bytes.push(arr[k]); }

  raw([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  u16(width); u16(height);
  var gctSizeField = minCodeSize - 1;
  bytes.push(0xF0 | gctSizeField); // GCT flag + size
  bytes.push(0); // bg color
  bytes.push(0); // aspect
  for (var i = 0; i < paletteInfo.tableSize; i++) {
    bytes.push(paletteInfo.colors[i][0], paletteInfo.colors[i][1], paletteInfo.colors[i][2]);
  }

  if (loop !== null) {
    raw([0x21, 0xFF, 0x0B]);
    raw([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]);
    bytes.push(0x03, 0x01);
    u16(loop & 0xffff);
    bytes.push(0x00);
  }

  for (var f = 0; f < frames.length; f++) {
    var frame = frames[f];
    var indices = quantizeAdaptive(frame.rgba, width, height, paletteInfo.colors, grid, transIndex, null);

    raw([0x21, 0xF9, 0x04]);
    var hasTrans = true; // adaptive always reserves trans slot
    bytes.push((1 << 2) | (hasTrans ? 1 : 0)); // disposal=1 + trans flag
    u16(frame.delayCs || 10);
    bytes.push(transIndex);
    bytes.push(0x00);

    bytes.push(0x2C);
    u16(0); u16(0); u16(width); u16(height);
    bytes.push(0x00);

    bytes.push(minCodeSize);
    var lzw = lzwEncode(indices, minCodeSize);
    var pos = 0;
    while (pos < lzw.length) {
      var len = Math.min(255, lzw.length - pos);
      bytes.push(len);
      for (var k = 0; k < len; k++) bytes.push(lzw[pos + k]);
      pos += len;
    }
    bytes.push(0x00);
  }

  bytes.push(0x3B);
  return new Uint8Array(bytes);
}

/**
 * 自适应调色板差量编码（与 buildGIFDiff 对应，使用全局自适应调色板）。
 */
function buildGIFDiffAdaptive(frames, opts) {
  opts = opts || {};
  var width = opts.width, height = opts.height;
  var loop = opts.loop !== undefined ? opts.loop : 0;
  var paletteInfo = buildAdaptivePalette(frames, 255);
  var grid = buildLookupGrid(paletteInfo.colors);
  var minCodeSize = paletteInfo.minCodeSize;
  var transIndex = paletteInfo.transIndex;
  var n = frames.length;

  var bytes = [];
  function u16(v) { bytes.push(v & 0xff, (v >> 8) & 0xff); }
  function raw(arr) { for (var k = 0; k < arr.length; k++) bytes.push(arr[k]); }

  raw([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  u16(width); u16(height);
  var gctSizeField = minCodeSize - 1;
  bytes.push(0xF0 | gctSizeField);
  bytes.push(0); bytes.push(0);
  for (var i = 0; i < paletteInfo.tableSize; i++) {
    bytes.push(paletteInfo.colors[i][0], paletteInfo.colors[i][1], paletteInfo.colors[i][2]);
  }

  if (loop !== null) {
    raw([0x21, 0xFF, 0x0B]);
    raw([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]);
    bytes.push(0x03, 0x01);
    u16(loop & 0xffff);
    bytes.push(0x00);
  }

  // 检测擦除（与 buildGIFDiff 相同的两遍逻辑）
  var erasure = new Array(n);
  erasure[0] = false;
  for (var f2 = 1; f2 < n; f2++) {
    erasure[f2] = false;
    var prev = frames[f2 - 1].rgba, cur = frames[f2].rgba;
    for (var e = 3; e < prev.length; e += 4) {
      if (prev[e] === 255 && cur[e] === 0) { erasure[f2] = true; break; }
    }
  }

  var canvasCleared = true;
  var prevRgba = null;

  for (var f3 = 0; f3 < n; f3++) {
    var frame = frames[f3];
    var rgba = frame.rgba;
    var delayCs = frame.delayCs || 10;
    var useDisposal2 = f3 < n - 1 && erasure[f3 + 1];

    var rectX, rectY, rectW, rectH, indices, hasTransparency;

    if (canvasCleared || useDisposal2) {
      rectX = 0; rectY = 0; rectW = width; rectH = height;
      indices = quantizeAdaptive(rgba, width, height, paletteInfo.colors, grid, transIndex, null);
      hasTransparency = true;
    } else {
      var bbox = findDirtyRect(prevRgba, rgba, width, height);
      if (!bbox) {
        rectX = 0; rectY = 0; rectW = 1; rectH = 1;
        indices = new Uint8Array(1);
        indices[0] = transIndex;
        hasTransparency = true;
      } else {
        rectX = bbox.x; rectY = bbox.y; rectW = bbox.w; rectH = bbox.h;
        // 量化 dirty rect
        var rectIndices = new Uint8Array(rectW * rectH);
        var BITS = 5, shift = 3;
        for (var ry = 0; ry < rectH; ry++) {
          for (var rx = 0; rx < rectW; rx++) {
            var sx = rectX + rx, sy = rectY + ry;
            var si = (sy * width + sx) * 4;
            var di = ry * rectW + rx;
            if (rgba[si + 3] < 128) {
              rectIndices[di] = transIndex;
            } else if (rgba[si] === prevRgba[si] && rgba[si + 1] === prevRgba[si + 1] &&
                       rgba[si + 2] === prevRgba[si + 2] && rgba[si + 3] === prevRgba[si + 3]) {
              rectIndices[di] = transIndex;
            } else {
              var gi = ((rgba[si + 1] >> shift) << 10) | ((rgba[si] >> shift) << 5) | (rgba[si + 2] >> shift);
              rectIndices[di] = grid[gi];
            }
          }
        }
        indices = rectIndices;
        hasTransparency = true;
      }
    }

    raw([0x21, 0xF9, 0x04]);
    var gcePacked = (useDisposal2 ? 2 : 1) << 2;
    if (hasTransparency) gcePacked |= 0x01;
    bytes.push(gcePacked);
    u16(delayCs);
    bytes.push(hasTransparency ? transIndex : 0);
    bytes.push(0x00);

    bytes.push(0x2C);
    u16(rectX); u16(rectY); u16(rectW); u16(rectH);
    bytes.push(0x00);

    bytes.push(minCodeSize);
    var lzw = lzwEncode(indices, minCodeSize);
    var pos2 = 0;
    while (pos2 < lzw.length) {
      var len2 = Math.min(255, lzw.length - pos2);
      bytes.push(len2);
      for (var k2 = 0; k2 < len2; k2++) bytes.push(lzw[pos2 + k2]);
      pos2 += len2;
    }
    bytes.push(0x00);

    prevRgba = rgba;
    canvasCleared = useDisposal2;
  }

  bytes.push(0x3B);
  return new Uint8Array(bytes);
}

module.exports = {
  buildGIF: buildGIF,
  buildGIFDiff: buildGIFDiff,
  buildGIFAdaptive: buildGIFAdaptive,
  buildGIFDiffAdaptive: buildGIFDiffAdaptive,
  buildAdaptivePalette: buildAdaptivePalette,
  buildLookupGrid: buildLookupGrid,
  quantizeAdaptive: quantizeAdaptive,
  nearestIndex: nearestIndex,
  lzwEncode: lzwEncode,
  PALETTE: PALETTE,
  PALETTE_BITS: PALETTE_BITS
};
