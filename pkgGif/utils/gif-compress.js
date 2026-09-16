// utils/gif-compress.js
// GIF 目标体积压缩：组合空间缩放/帧抽取/调色板策略，迭代逼近目标体积。
// 纯函数 + 编码器调用，无 wx 依赖，可 node 测试。
//
// 策略阶梯（从低到高压缩率）：
//   1. 原始尺寸 + 全帧 + 固定色板 + 无抖动
//   2. 缩放 0.875 + 全帧
//   3. 缩放 0.75 + 全帧
//   4. 缩放 0.75 + 每 2 帧取 1（延时翻倍，保首尾与总时长）
//   5. 缩放 0.625 + 每 2 帧取 1
//   6. 缩放 0.5 + 每 2 帧取 1
//   7. 缩放 0.5 + 每 3 帧取 1（延时×3）
//   8. 缩放 0.375 + 每 3 帧取 1
//   9. 缩放 0.25 + 每 4 帧取 1
// 命中目标即停；全部未达标则返回最小体积结果。

'use strict';

var { buildGIF, buildGIFDiff, buildGIFAdaptive, buildGIFDiffAdaptive } = require('./gif-encoder.js');
var { cropFrame } = require('./gif-frame-ops.js');

// 缩放因子阶梯（保持宽高比）
var SCALE_STEPS = [1, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25];

/**
 * 最近邻缩放一帧 RGBA
 * @param {Uint8Array} rgba
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} dstW
 * @param {number} dstH
 * @returns {Uint8Array}
 */
function scaleFrame(rgba, srcW, srcH, dstW, dstH) {
  var out = new Uint8Array(dstW * dstH * 4);
  for (var y = 0; y < dstH; y++) {
    var sy = Math.min(srcH - 1, Math.floor(y * srcH / dstH));
    for (var x = 0; x < dstW; x++) {
      var sx = Math.min(srcW - 1, Math.floor(x * srcW / dstW));
      var si = (sy * srcW + sx) * 4;
      var di = (y * dstW + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

/**
 * 帧抽取：按间隔保留帧，调整延时保持总时长，强制保留首尾帧。
 * @param {Array} frames [{rgba, delayMs, ...}]
 * @param {number} step 保留间隔（2=每2帧取1，3=每3帧取1）
 * @returns {Array}
 */
function sampleFrames(frames, step) {
  if (step <= 1) return frames;
  var result = [];
  var n = frames.length;
  for (var i = 0; i < n; i += step) {
    var f = frames[i];
    // 计算这组帧的总延时
    var groupEnd = Math.min(i + step - 1, n - 1);
    var totalDelay = 0;
    for (var j = i; j <= groupEnd; j++) {
      totalDelay += frames[j].delayMs || 100;
    }
    result.push({
      rgba: f.rgba,
      delayMs: Math.max(20, totalDelay),
      width: f.width,
      height: f.height
    });
  }
  // 确保最后一帧存在
  if (result[result.length - 1].rgba !== frames[n - 1].rgba) {
    var last = frames[n - 1];
    result.push({
      rgba: last.rgba,
      delayMs: last.delayMs || 100,
      width: last.width,
      height: last.height
    });
  }
  return result;
}

/**
 * 生成压缩策略阶梯
 * @param {number} frameCount
 * @returns {Array<{scale:number, frameStep:number, useAdaptive:boolean, label:string}>}
 */
function buildStrategyLadder(frameCount) {
  var strategies = [];
  // Level 0: 原始，固定色板
  strategies.push({ scale: 1, frameStep: 1, useAdaptive: false, label: 'original-fixed' });
  // Level 1: 原始，自适应色板（可能更小，也可能更大，先试）
  strategies.push({ scale: 1, frameStep: 1, useAdaptive: true, label: 'original-adaptive' });
  // 逐步缩放 + 帧抽取
  var combos = [
    { scale: 0.875, frameStep: 1 },
    { scale: 0.75, frameStep: 1 },
    { scale: 0.75, frameStep: 2 },
    { scale: 0.625, frameStep: 2 },
    { scale: 0.5, frameStep: 2 },
    { scale: 0.5, frameStep: 3 },
    { scale: 0.375, frameStep: 3 },
    { scale: 0.25, frameStep: 4 }
  ];
  for (var i = 0; i < combos.length; i++) {
    strategies.push({
      scale: combos[i].scale,
      frameStep: combos[i].frameStep,
      useAdaptive: false,
      label: 'scale' + combos[i].scale + '-step' + combos[i].frameStep
    });
  }
  return strategies;
}

/**
 * 用指定策略编码一帧序列
 */
function encodeWithStrategy(frames, width, height, strategy, loop) {
  // 1. 帧抽取
  var sampled = sampleFrames(frames, strategy.frameStep);
  if (sampled.length === 0) return null;

  // 2. 空间缩放
  var dstW = Math.max(4, Math.round(width * strategy.scale));
  var dstH = Math.max(4, Math.round(height * strategy.scale));

  var scaledFrames;
  if (strategy.scale === 1) {
    scaledFrames = sampled;
  } else {
    scaledFrames = sampled.map(function (f) {
      return {
        rgba: scaleFrame(f.rgba, width, height, dstW, dstH),
        delayCs: Math.max(2, Math.round(f.delayMs / 10)),
        width: dstW,
        height: dstH
      };
    });
  }

  // 确保 delayCs 字段
  for (var i = 0; i < scaledFrames.length; i++) {
    if (!scaledFrames[i].delayCs) {
      scaledFrames[i].delayCs = Math.max(2, Math.round((scaledFrames[i].delayMs || 100) / 10));
    }
  }

  var opts = { width: dstW, height: dstH, loop: loop !== undefined ? loop : 0, dither: false };
  var encoder;
  if (strategy.useAdaptive) {
    encoder = scaledFrames.length > 1 ? buildGIFDiffAdaptive : buildGIFAdaptive;
  } else {
    encoder = scaledFrames.length > 1 ? buildGIFDiff : buildGIF;
  }

  try {
    var bytes = encoder(scaledFrames, opts);
    return {
      bytes: bytes,
      width: dstW,
      height: dstH,
      frameCount: scaledFrames.length,
      strategy: strategy.label
    };
  } catch (e) {
    return null;
  }
}

/**
 * 压缩 GIF 到目标体积。
 * @param {Array} frames 解码后的帧 [{rgba, delayMs, width, height}]
 * @param {number} width 原始宽
 * @param {number} height 原始高
 * @param {number} targetBytes 目标字节数
 * @param {object} [opts] { loop, onProgress(level, totalLevels) }
 * @returns {{bytes:Uint8Array, width:number, height:number, frameCount:number,
 *            strategy:string, originalSize:number, compressedSize:number,
 *            metTarget:boolean, attempts:number}}
 */
function compressGif(frames, width, height, targetBytes, opts) {
  opts = opts || {};
  var loop = opts.loop;
  var onProgress = opts.onProgress;

  // 先尝试原始体积
  var original = encodeWithStrategy(frames, width, height,
    { scale: 1, frameStep: 1, useAdaptive: false, label: 'original' }, loop);
  var originalSize = original ? original.bytes.length : 0;

  // 已达标
  if (originalSize > 0 && originalSize <= targetBytes) {
    if (onProgress) onProgress(1, 1);
    return {
      bytes: original.bytes,
      width: width,
      height: height,
      frameCount: frames.length,
      strategy: 'original',
      originalSize: originalSize,
      compressedSize: originalSize,
      metTarget: true,
      attempts: 1
    };
  }

  var ladder = buildStrategyLadder(frames.length);
  var best = original;
  var bestSize = originalSize;
  var attempts = 1;

  for (var i = 0; i < ladder.length; i++) {
    if (onProgress) onProgress(i + 1, ladder.length + 1);
    var result = encodeWithStrategy(frames, width, height, ladder[i], loop);
    attempts++;
    if (!result) continue;

    if (result.bytes.length < bestSize) {
      best = result;
      bestSize = result.bytes.length;
    }

    // 命中目标
    if (result.bytes.length <= targetBytes) {
      return {
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        frameCount: result.frameCount,
        strategy: result.strategy,
        originalSize: originalSize,
        compressedSize: result.bytes.length,
        metTarget: true,
        attempts: attempts
      };
    }
  }

  // 未达标，返回最优
  if (onProgress) onProgress(ladder.length + 1, ladder.length + 1);
  return {
    bytes: best.bytes,
    width: best.width,
    height: best.height,
    frameCount: best.frameCount,
    strategy: best.strategy + '-best',
    originalSize: originalSize,
    compressedSize: bestSize,
    metTarget: false,
    attempts: attempts
  };
}

module.exports = {
  compressGif: compressGif,
  scaleFrame: scaleFrame,
  sampleFrames: sampleFrames,
  buildStrategyLadder: buildStrategyLadder,
  encodeWithStrategy: encodeWithStrategy
};
