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

module.exports = {
  buildGIF: buildGIF,
  nearestIndex: nearestIndex,
  lzwEncode: lzwEncode,
  PALETTE: PALETTE,
  PALETTE_BITS: PALETTE_BITS
};
