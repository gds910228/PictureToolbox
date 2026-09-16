// utils/gif-decoder.js
// 自包含 GIF89a/87a 解码器（无依赖、不依赖 wx API，可被 node 直接 require 测试）。
//
// 能力：
//   - 全局/局部颜色表（GCT/LCT），LCT 优先
//   - 透明索引（Graphic Control Extension 的 transparent color flag）
//   - 隔行扫描（interlace）四趟还原
//   - disposal 0/1/2（3 罕见，按 1 处理：不恢复）
//   - 帧延迟 1/100 秒 → delayMs
//   - NETSCAPE2.0 循环计数
//   - LZW 解压缩（min code size 2..8，码宽 3..12，LSB-first 打包）
//
// 输出契约（供外部测试脚本统一调用）：
//   module.exports = { decodeGif }
//   decodeGif(arrayBuffer) -> {
//     width, height, loopCount, frameCount,
//     frames: [{ index, delayMs, disposal, rgba: Uint8Array(width*height*4) }]
//   }
//   rgba 为按 disposal 规则合成后的完整画布帧（透明区域 alpha=0）。
//   非法输入 throw Error 并带原因。
//
// 设计要点：
//   - 逐帧维护一个"画布"（prevCanvas，Uint8ClampedArray RGBA），按 disposal 规则推进，
//     每帧把当前画布完整快照存入 frames[].rgba（编辑/导出需要完整帧，而非差分）。
//   - disposal 2（restore to background）：帧绘制区域在"下一帧之前"恢复为透明。
//   - disposal 3（restore to previous）：按 1 处理（不恢复），罕见且实现复杂，需求允许。
//   - 背景色索引仅影响"无 GCT 时"的兜底；有 GCT 时背景色不自动填充（GIF 规范如此）。

'use strict';

// 隔行扫描的行起点与步长（GIF 规范四趟）
const INTERLACE_PASSES = [
  { start: 0, step: 8 },
  { start: 4, step: 8 },
  { start: 2, step: 4 },
  { start: 1, step: 2 }
];

/**
 * 解码 GIF ArrayBuffer。
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{width:number,height:number,loopCount:number,frameCount:number,frames:Array}}
 */
function decodeGif(arrayBuffer) {
  if (!arrayBuffer || typeof arrayBuffer.byteLength !== 'number' || arrayBuffer.byteLength < 13) {
    throw new Error('无效输入：需要至少 13 字节的 ArrayBuffer');
  }

  var bytes = new Uint8Array(arrayBuffer);
  var pos = 0;
  var len = bytes.length;

  function u8() {
    if (pos >= len) throw new Error('文件意外结束（读取 u8 @' + pos + '）');
    return bytes[pos++];
  }
  function u16() {
    if (pos + 1 >= len) throw new Error('文件意外结束（读取 u16 @' + pos + '）');
    var v = bytes[pos] | (bytes[pos + 1] << 8);
    pos += 2;
    return v;
  }
  function peek() {
    if (pos >= len) return -1;
    return bytes[pos];
  }

  // ---- 文件头 ----
  var sig = String.fromCharCode(u8(), u8(), u8(), u8(), u8(), u8());
  if (sig !== 'GIF87a' && sig !== 'GIF89a') {
    throw new Error('不是 GIF 文件（文件头应为 GIF87a/GIF89a，实际：' + sig + '）');
  }

  var screenWidth = u16();
  var screenHeight = u16();
  if (screenWidth === 0 || screenHeight === 0) {
    throw new Error('GIF 逻辑屏幕尺寸为 0');
  }
  var packed = u8();
  var gctFlag = (packed & 0x80) !== 0;
  var gctSize = 2 << (packed & 0x07); // 2^(N+1) 项
  var bgColorIndex = u8();
  u8(); // pixel aspect ratio（忽略）

  // ---- 全局颜色表 ----
  var gct = null;
  if (gctFlag) {
    var gctBytes = gctSize * 3;
    if (pos + gctBytes > len) throw new Error('全局颜色表超出文件范围');
    gct = readPalette(bytes, pos, gctSize);
    pos += gctBytes;
  }

  var loopCount = 1; // 默认播放一次（无 NETSCAPE 扩展）
  var frameDefs = [];
  // 待应用到下一帧图像的 GCE 参数
  var pendingGce = null;

  // ---- 块遍历（带安全计数，防止损坏数据导致死循环）----
  var blockCount = 0;
  var MAX_BLOCKS = 65536;
  while (pos < len) {
    if (++blockCount > MAX_BLOCKS) throw new Error('块数量超过上限（可能文件损坏）');
    var introducer = u8();
    if (introducer === 0x3B) {
      // Trailer
      break;
    } else if (introducer === 0x21) {
      // Extension
      var label = u8();
      if (label === 0xF9) {
        // Graphic Control Extension
        var blockSize = u8();
        if (blockSize !== 4) throw new Error('GCE 块大小应为 4，实际 ' + blockSize);
        var gcePacked = u8();
        var delayCs = u16();
        var transIndex = u8();
        u8(); // block terminator
        pendingGce = {
          disposal: (gcePacked & 0x1C) >> 2,
          transparentFlag: (gcePacked & 0x01) !== 0,
          delayCs: delayCs,
          transIndex: transIndex
        };
      } else if (label === 0xFF) {
        // Application Extension — 读子块，识别 NETSCAPE2.0
        var appBlockSize = u8();
        if (appBlockSize !== 11) {
          // 非常规应用扩展，跳过
          skipSubBlocks();
          continue;
        }
        var appId = '';
        for (var ai = 0; ai < 11; ai++) appId += String.fromCharCode(u8());
        if (appId === 'NETSCAPE2.0' || appId === 'ANIMEXTS1.0') {
          // 后续子块：03 01 <loop low> <loop high> 00
          var subSize = u8();
          if (subSize === 3) {
            var subId = u8();
            if (subId === 1) {
              loopCount = u16();
              u8(); // block terminator
            } else {
              // 非循环子块，跳过剩余
              skipSubBlocks();
            }
          } else {
            skipSubBlocks();
          }
        } else {
          skipSubBlocks();
        }
      } else {
        // 其他扩展（Comment 0xFE, Plain Text 0x01, 未知）— 跳过子块
        skipSubBlocks();
      }
    } else if (introducer === 0x2C) {
      // Image Descriptor
      var imgLeft = u16();
      var imgTop = u16();
      var imgWidth = u16();
      var imgHeight = u16();
      var imgPacked = u8();
      var lctFlag = (imgPacked & 0x80) !== 0;
      var interlace = (imgPacked & 0x40) !== 0;
      var lctSize = 2 << (imgPacked & 0x07);

      var palette = gct;
      if (lctFlag) {
        var lctBytes = lctSize * 3;
        if (pos + lctBytes > len) throw new Error('局部颜色表超出文件范围');
        palette = readPalette(bytes, pos, lctSize);
        pos += lctBytes;
      }
      if (!palette) {
        throw new Error('图像既无全局颜色表也无局部颜色表');
      }

      var minCodeSize = u8();
      if (minCodeSize < 2 || minCodeSize > 8) {
        throw new Error('LZW 最小码宽应为 2..8，实际 ' + minCodeSize);
      }
      var lzwData = readSubBlocks();
      var indices = lzwDecode(lzwData, minCodeSize, imgWidth * imgHeight);

      // 应用 GCE
      var gce = pendingGce || {};
      var transparentFlag = !!gce.transparentFlag;
      var transColorIdx = gce.transIndex || 0;
      var disposal = gce.disposal || 0;
      var delayMs = (gce.delayCs || 0) * 10;

      frameDefs.push({
        left: imgLeft,
        top: imgTop,
        width: imgWidth,
        height: imgHeight,
        interlace: interlace,
        palette: palette,
        transparentFlag: transparentFlag,
        transIndex: transColorIdx,
        disposal: disposal,
        delayMs: delayMs,
        indices: indices
      });
      pendingGce = null;
    } else {
      throw new Error('未知块标识符 0x' + introducer.toString(16) + ' @' + (pos - 1));
    }
  }

  if (frameDefs.length === 0) {
    throw new Error('GIF 不包含任何图像帧');
  }

  // ---- 帧合成（disposal 推进）----
  var canvas = new Uint8ClampedArray(screenWidth * screenHeight * 4);
  // 全透明初始
  // （Uint8ClampedArray 默认 0，alpha=0 即透明）

  var frames = new Array(frameDefs.length);
  for (var fi = 0; fi < frameDefs.length; fi++) {
    var fd = frameDefs[fi];

    // 先记录"绘制前"画布快照（用于 disposal 3，但我们按 1 处理，不需要；
    // 不过 disposal 2 需要在绘制后清区域，所以这里先绘制）
    blitFrame(canvas, screenWidth, screenHeight, fd);

    // 复制当前画布为该帧输出
    var out = new Uint8Array(canvas.length);
    out.set(canvas);
    frames[fi] = {
      index: fi,
      delayMs: fd.delayMs,
      disposal: fd.disposal,
      rgba: out
    };

    // disposal 推进：为下一帧准备画布
    if (fd.disposal === 2) {
      // restore to background — 清除本帧绘制区域为透明
      clearRect(canvas, screenWidth, fd.left, fd.top, fd.width, fd.height);
    }
    // disposal 0/1/3：画布保留（3 按 1 处理）
  }

  return {
    width: screenWidth,
    height: screenHeight,
    loopCount: loopCount,
    frameCount: frames.length,
    frames: frames
  };

  // ---- 内部函数 ----

  function skipSubBlocks() {
    var s;
    while ((s = u8()) !== 0) {
      if (pos + s > len) throw new Error('子块超出文件范围');
      pos += s;
    }
  }

  function readSubBlocks() {
    var chunks = [];
    var total = 0;
    var s;
    while ((s = u8()) !== 0) {
      if (pos + s > len) throw new Error('LZW 子块超出文件范围');
      chunks.push(bytes.subarray(pos, pos + s));
      total += s;
      pos += s;
    }
    var out = new Uint8Array(total);
    var off = 0;
    for (var ci = 0; ci < chunks.length; ci++) {
      out.set(chunks[ci], off);
      off += chunks[ci].length;
    }
    return out;
  }
}

function readPalette(bytes, offset, count) {
  var p = new Array(count);
  for (var i = 0; i < count; i++) {
    p[i] = [
      bytes[offset + i * 3],
      bytes[offset + i * 3 + 1],
      bytes[offset + i * 3 + 2]
    ];
  }
  return p;
}

// 把一帧（含调色板/透明/隔行）blit 到画布
function blitFrame(canvas, screenW, screenH, fd) {
  var x0 = fd.left;
  var y0 = fd.top;
  var w = fd.width;
  var h = fd.height;
  var pal = fd.palette;
  var transFlag = fd.transparentFlag;
  var transIdx = fd.transIndex;
  var indices = fd.indices;

  // 隔行扫描：LZW 数据按四趟顺序存储行，rowOrder[storedRow] = canvasRow
  // 非隔行：第 sy 行直接对应画布第 sy 行
  var rowOrder = null;
  if (fd.interlace) {
    rowOrder = new Array(h);
    var r = 0;
    for (var pass = 0; pass < 4; pass++) {
      var p = INTERLACE_PASSES[pass];
      for (var y = p.start; y < h; y += p.step) {
        rowOrder[r++] = y;
      }
    }
  }

  for (var sy = 0; sy < h; sy++) {
    var canvasY = y0 + (rowOrder ? rowOrder[sy] : sy);
    if (canvasY < 0 || canvasY >= screenH) continue;
    var srcRowStart = sy * w;
    for (var sx = 0; sx < w; sx++) {
      var canvasX = x0 + sx;
      if (canvasX < 0 || canvasX >= screenW) continue;
      var idx = indices[srcRowStart + sx];
      if (transFlag && idx === transIdx) continue; // 透明：不覆盖画布
      var rgb = pal[idx];
      if (!rgb) continue;
      var co = (canvasY * screenW + canvasX) * 4;
      canvas[co] = rgb[0];
      canvas[co + 1] = rgb[1];
      canvas[co + 2] = rgb[2];
      canvas[co + 3] = 255;
    }
  }
}

function clearRect(canvas, screenW, x0, y0, w, h) {
  for (var y = y0; y < y0 + h; y++) {
    if (y < 0) continue;
    var rowStart = y * screenW;
    for (var x = x0; x < x0 + w; x++) {
      if (x < 0) continue;
      var co = (rowStart + x) * 4;
      canvas[co] = 0;
      canvas[co + 1] = 0;
      canvas[co + 2] = 0;
      canvas[co + 3] = 0;
    }
  }
}

/**
 * LZW 解压缩（GIF 变体）。
 * @param {Uint8Array} data 拼接后的 LZW 子块数据
 * @param {number} minCodeSize LZW 最小码宽
 * @param {number} pixelCount 期望输出的索引数（imgWidth*imgHeight）
 * @returns {Uint8Array} 长度为 pixelCount 的调色板索引
 */
function lzwDecode(data, minCodeSize, pixelCount) {
  var clearCode = 1 << minCodeSize;
  var eoiCode = clearCode + 1;
  var codeSize = minCodeSize + 1;
  var nextCode = eoiCode + 1;
  var maxCode = 1 << codeSize;

  // 字典：prefix[code] = 前缀码，suffix[code] = 追加字节
  var prefix = new Int32Array(4096);
  var suffix = new Uint8Array(4096);
  for (var i = 0; i < clearCode; i++) {
    prefix[i] = -1;
    suffix[i] = i;
  }

  var out = new Uint8Array(pixelCount);
  var outPos = 0;

  // 位读取器（LSB first）
  var bitPos = 0;
  var dataLen = data.length;

  function readCode() {
    if (bitPos + codeSize > dataLen * 8) {
      return eoiCode; // 数据不足，视为结束
    }
    var code = 0;
    for (var b = 0; b < codeSize; b++) {
      var byteIdx = (bitPos + b) >> 3;
      var bitIdx = (bitPos + b) & 7;
      if (data[byteIdx] & (1 << bitIdx)) {
        code |= (1 << b);
      }
    }
    bitPos += codeSize;
    return code;
  }

  var oldCode = -1;
  var firstByte = 0;

  // 用于反解字典条目的栈
  var stack = new Uint8Array(4096);

  // 安全限制：LZW 迭代次数上限（防止损坏数据死循环）
  var maxIterations = pixelCount * 4 + 8192;
  var iterations = 0;

  while (true) {
    if (++iterations > maxIterations) {
      throw new Error('LZW 迭代次数超过上限（数据可能损坏）');
    }
    var code = readCode();
    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      maxCode = 1 << codeSize;
      nextCode = eoiCode + 1;
      oldCode = -1;
      continue;
    }
    if (code === eoiCode) break;

    // 反解 code → 字节序列
    var c = code;
    var sp = 0;
    if (code === nextCode && oldCode !== -1) {
      // KwKwK 特殊情况
      stack[sp++] = firstByte;
      c = oldCode;
    } else if (code >= nextCode) {
      throw new Error('LZW 解码遇到无效码 ' + code + '（nextCode=' + nextCode + '）');
    }
    while (c >= clearCode) {
      stack[sp++] = suffix[c];
      c = prefix[c];
    }
    stack[sp++] = c; // 根字节（字面量）
    firstByte = c;

    // 输出（栈是反序，弹栈即正序）
    while (sp > 0) {
      if (outPos < pixelCount) {
        out[outPos++] = stack[--sp];
      } else {
        sp--; // 丢弃多余
      }
    }

    // 新增字典条目
    if (oldCode !== -1 && nextCode < 4096) {
      prefix[nextCode] = oldCode;
      suffix[nextCode] = firstByte;
      nextCode++;
      // 码宽递增时机（关键，与编码器对齐）：
      // 解码器在"插入一个条目后"检查 nextCode >= 2^codeSize 即递增。
      // 这比编码器（post-increment `>`，插入 2^w 后才递增）早一个条目，
      // 恰好补偿"编码器先加条目再写下一码、解码器先读码再加条目"的一步时差，
      // 使两边读写下一码时码宽一致。（已用 omggif 交叉验证）
      if (nextCode >= maxCode && codeSize < 12) {
        codeSize++;
        maxCode = 1 << codeSize;
      }
    }
    oldCode = code;
  }

  if (outPos < pixelCount) {
    // 部分解码器在数据不足时填 0；这里用透明/0 填充
    for (var p = outPos; p < pixelCount; p++) out[p] = 0;
  }
  return out;
}

/**
 * 分块解码：先解析结构，再逐批合成帧，支持进度回调与取消。
 * 用于超大 GIF（>150 帧或单帧 >4M 像素）。
 *
 * @param {ArrayBuffer} buffer
 * @param {object} opts { batchSize=8, onProgress(decoded,total), shouldCancel() }
 * @returns {Promise<{width,height,loopCount,frameCount,frames}>}
 */
function decodeGifChunked(buffer, opts) {
  opts = opts || {};
  var batchSize = opts.batchSize || 8;
  var onProgress = opts.onProgress;
  var shouldCancel = opts.shouldCancel;

  return new Promise(function (resolve, reject) {
    try {
      // 第一阶段：解析（同步，快）
      var bytes = new Uint8Array(buffer);
      var len = bytes.length;
      var pos = 0;

      function u8() { if (pos >= len) throw new Error('意外文件结束'); return bytes[pos++]; }
      function u16() { var v = bytes[pos] | (bytes[pos + 1] << 8); pos += 2; return v; }

      var sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
      if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('不是 GIF 文件');
      pos = 6;
      var screenWidth = u16(), screenHeight = u16();
      var packed = u8();
      var gctFlag = (packed & 0x80) !== 0;
      var gctSize = 2 << (packed & 0x07);
      u8(); u8();
      var gct = null;
      if (gctFlag) { gct = readPalette(bytes, pos, gctSize); pos += gctSize * 3; }

      var loopCount = 1;
      var frameDefs = [];
      var pendingGce = null;
      var blockCount = 0;

      while (pos < len) {
        if (++blockCount > 65536) throw new Error('块数量超限');
        var introducer = u8();
        if (introducer === 0x3B) break;
        if (introducer === 0x21) {
          var label = u8();
          if (label === 0xF9) {
            u8(); var gcePacked = u8();
            var delayCs = u16();
            var transIdx = u8(); u8();
            pendingGce = {
              disposal: (gcePacked >> 2) & 0x07,
              transparentFlag: (gcePacked & 0x01) !== 0,
              transIndex: transIdx,
              delayCs: delayCs
            };
          } else if (label === 0xFF) {
            var appSize = u8();
            if (appSize === 11 && pos + 11 <= len) {
              var appId = '';
              for (var ai = 0; ai < 11; ai++) appId += String.fromCharCode(bytes[pos + ai]);
              pos += 11;
              if (appId === 'NETSCAPE2.0') {
                var subSize = u8();
                if (subSize === 3) { u8(); loopCount = u16(); u8(); }
                else { var s2; while ((s2 = u8()) !== 0) pos += s2; }
              } else { var s3; while ((s3 = u8()) !== 0) pos += s3; }
            } else { var s4; while ((s4 = u8()) !== 0) pos += s4; }
          } else {
            var s5; while ((s5 = u8()) !== 0) pos += s5;
          }
        } else if (introducer === 0x2C) {
          var left = u16(), top = u16(), iw = u16(), ih = u16();
          var imgPacked = u8();
          var lctF = (imgPacked & 0x80) !== 0;
          var interlace = (imgPacked & 0x40) !== 0;
          var lctS = 2 << (imgPacked & 0x07);
          var pal = gct;
          if (lctF) { pal = readPalette(bytes, pos, lctS); pos += lctS * 3; }
          if (!pal) throw new Error('无颜色表');
          var mcs = u8();
          // 读取 LZW 原始字节但不解码
          var chunks = [];
          var totalLzw = 0;
          var sl;
          while ((sl = u8()) !== 0) {
            if (pos + sl > len) throw new Error('LZW 数据超限');
            chunks.push(bytes.subarray(pos, pos + sl));
            totalLzw += sl;
            pos += sl;
          }
          var lzwRaw = new Uint8Array(totalLzw);
          var off = 0;
          for (var ci = 0; ci < chunks.length; ci++) { lzwRaw.set(chunks[ci], off); off += chunks[ci].length; }

          var gce = pendingGce || {};
          frameDefs.push({
            left: left, top: top, width: iw, height: ih,
            interlace: interlace, palette: pal,
            transparentFlag: !!gce.transparentFlag,
            transIndex: gce.transIndex || 0,
            disposal: gce.disposal || 0,
            delayMs: (gce.delayCs || 0) * 10,
            lzwRaw: lzwRaw, minCodeSize: mcs
          });
          pendingGce = null;
        } else {
          throw new Error('未知块 0x' + introducer.toString(16));
        }
      }
      if (frameDefs.length === 0) throw new Error('无图像帧');

      // 第二阶段：分批合成
      var canvas = new Uint8ClampedArray(screenWidth * screenHeight * 4);
      var frames = new Array(frameDefs.length);
      var decoded = 0;

      function processBatch() {
        if (shouldCancel && shouldCancel()) {
          reject(new Error('已取消'));
          return;
        }
        var end = Math.min(decoded + batchSize, frameDefs.length);
        for (var fi = decoded; fi < end; fi++) {
          var fd = frameDefs[fi];
          // 延迟 LZW 解码到合成时
          fd.indices = lzwDecode(fd.lzwRaw, fd.minCodeSize, fd.width * fd.height);
          blitFrame(canvas, screenWidth, screenHeight, fd);
          var out = new Uint8Array(canvas.length);
          out.set(canvas);
          frames[fi] = { index: fi, delayMs: fd.delayMs, disposal: fd.disposal, rgba: out };
          if (fd.disposal === 2) clearRect(canvas, screenWidth, fd.left, fd.top, fd.width, fd.height);
        }
        decoded = end;
        if (onProgress) onProgress(decoded, frameDefs.length);
        if (decoded < frameDefs.length) {
          setTimeout(processBatch, 0);
        } else {
          resolve({
            width: screenWidth, height: screenHeight,
            loopCount: loopCount, frameCount: frames.length, frames: frames
          });
        }
      }
      setTimeout(processBatch, 0);
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  decodeGif: decodeGif,
  decodeGifChunked: decodeGifChunked
};
