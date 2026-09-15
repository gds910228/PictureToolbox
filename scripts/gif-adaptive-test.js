// scripts/gif-adaptive-test.js
// 自适应调色板测试（零 npm 依赖，node 直接运行）。
// 覆盖：画质对比、体积变化、makeGif 回归、透明 round-trip、minCodeSize、差量路径。
//
// 运行：node scripts/gif-adaptive-test.js

'use strict';

const path = require('path');
const {
  buildGIF, buildGIFDiff, buildGIFAdaptive, buildGIFDiffAdaptive,
  buildAdaptivePalette, buildLookupGrid
} = require(path.join(__dirname, '..', 'utils', 'gif-encoder.js'));
const { decodeGif } = require(path.join(__dirname, '..', 'utils', 'gif-decoder.js'));

let pass = 0, fail = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; failures.push(msg); console.error('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (expected=' + b + ', actual=' + a + ')'); }

function matchRate(orig, decoded, tol) {
  let match = 0, total = 0;
  for (let i = 0; i < orig.length; i += 4) {
    if (orig[i + 3] >= 128 && decoded[i + 3] >= 128) {
      let good = true;
      for (let c = 0; c < 3; c++) {
        if (Math.abs(orig[i + c] - decoded[i + c]) > tol) good = false;
      }
      if (good) match++;
      total++;
    }
  }
  return total > 0 ? match / total : 1;
}

function makeGradient(W, H, frames) {
  const result = [];
  for (let f = 0; f < frames; f++) {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = (x * 4 + f * 20) % 256;
      rgba[i + 1] = (y * 4 + f * 10) % 256;
      rgba[i + 2] = ((x + y) * 2 + f * 15) % 256;
      rgba[i + 3] = 255;
    }
    result.push({ width: W, height: H, rgba, delayCs: 10 });
  }
  return result;
}

function makePhoto(W, H, frames) {
  const result = [];
  for (let f = 0; f < frames; f++) {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = Math.round(128 + 127 * Math.sin(x / 20 + f));
      rgba[i + 1] = Math.round(128 + 127 * Math.sin(y / 25 + f * 0.5));
      rgba[i + 2] = Math.round(128 + 127 * Math.cos((x + y) / 30));
      rgba[i + 3] = 255;
    }
    result.push({ width: W, height: H, rgba, delayCs: 10 });
  }
  return result;
}

function makeScreenRecording(W, H, frames) {
  const result = [];
  const bg = [100, 150, 200];
  for (let f = 0; f < frames; f++) {
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255;
    }
    const bw = Math.round(W * 0.1), bh = Math.round(H * 0.1);
    const cx = (f * Math.round(bw * 0.4)) % (W - bw);
    const cy = (f * Math.round(bh * 0.3)) % (H - bh);
    for (let y = cy; y < cy + bh && y < H; y++) {
      for (let x = cx; x < cx + bw && x < W; x++) {
        const i = (y * W + x) * 4;
        rgba[i] = (f * 30) % 256; rgba[i + 1] = (f * 20) % 256; rgba[i + 2] = (f * 10) % 256;
      }
    }
    result.push({ width: W, height: H, rgba, delayCs: 5 });
  }
  return result;
}

console.log('=== Adaptive Palette Tests ===\n');

// ---- 1. makeGif 字节级回归（buildGIF 不传 adaptive 参数时完全不变）----
console.log('[1] makeGif 回归（buildGIF 无 adaptive 参数）');
{
  const frames = makeGradient(32, 32, 3);
  const gif1 = buildGIF(frames, { width: 32, height: 32, loop: 0, dither: false });
  // buildGIF 不支持 adaptive 参数，传了也应忽略
  const gif2 = buildGIF(frames, { width: 32, height: 32, loop: 0, dither: false, adaptive: true });
  eq(gif1.length, gif2.length, 'buildGIF output length unchanged with adaptive param');
  let identical = true;
  for (let i = 0; i < gif1.length; i++) {
    if (gif1[i] !== gif2[i]) { identical = false; break; }
  }
  ok(identical, 'buildGIF output byte-identical with adaptive param');
}

// ---- 2. 自适应调色板基本功能 ----
console.log('[2] 自适应调色板基本功能');
{
  const frames = makeGradient(32, 32, 2);
  const gif = buildGIFAdaptive(frames, { width: 32, height: 32, loop: 0 });
  const decoded = decodeGif(gif.buffer);
  eq(decoded.width, 32, 'decoded width');
  eq(decoded.height, 32, 'decoded height');
  eq(decoded.frameCount, 2, 'decoded frame count');
  eq(decoded.frames[0].rgba.length, 32 * 32 * 4, 'rgba length correct');
}

// ---- 3. 画质提升（自适应 > 固定调色板）----
console.log('[3] 画质提升（渐变样本）');
{
  const W = 64, H = 64;
  const frames = makeGradient(W, H, 5);
  const fixedGif = buildGIF(frames, { width: W, height: H, loop: 0, dither: false });
  const adapGif = buildGIFAdaptive(frames, { width: W, height: H, loop: 0 });
  const fixedDec = decodeGif(fixedGif.buffer);
  const adapDec = decodeGif(adapGif.buffer);
  const fixedRate = matchRate(frames[2].rgba, fixedDec.frames[2].rgba, 8);
  const adapRate = matchRate(frames[2].rgba, adapDec.frames[2].rgba, 8);
  console.log('  Fixed ±8:    ' + (fixedRate * 100).toFixed(1) + '% (' + fixedGif.length + 'B)');
  console.log('  Adaptive ±8: ' + (adapRate * 100).toFixed(1) + '% (' + adapGif.length + 'B)');
  ok(adapRate > fixedRate, 'adaptive match rate > fixed (got ' +
    (adapRate * 100).toFixed(1) + '% vs ' + (fixedRate * 100).toFixed(1) + '%)');
}

// ---- 4. 照片类样本质检 ----
console.log('[4] 照片类样本');
{
  const W = 64, H = 64;
  const frames = makePhoto(W, H, 3);
  const fixedGif = buildGIF(frames, { width: W, height: H, loop: 0, dither: false });
  const adapGif = buildGIFAdaptive(frames, { width: W, height: H, loop: 0 });
  const fixedDec = decodeGif(fixedGif.buffer);
  const adapDec = decodeGif(adapGif.buffer);
  const fixedRate = matchRate(frames[0].rgba, fixedDec.frames[0].rgba, 8);
  const adapRate = matchRate(frames[0].rgba, adapDec.frames[0].rgba, 8);
  console.log('  Fixed ±8:    ' + (fixedRate * 100).toFixed(1) + '% (' + fixedGif.length + 'B)');
  console.log('  Adaptive ±8: ' + (adapRate * 100).toFixed(1) + '% (' + adapGif.length + 'B)');
  ok(adapRate > fixedRate, 'photo adaptive > fixed');
}

// ---- 5. 屏幕录制差量缩减率劣化 ≤5% ----
console.log('[5] 屏幕录制差量缩减率（自适应劣化 ≤5%）');
{
  const W = 120, H = 120;
  const frames = makeScreenRecording(W, H, 30);
  const diffFixed = buildGIFDiff(frames, { width: W, height: H, loop: 0, dither: false });
  const diffAdap = buildGIFDiffAdaptive(frames, { width: W, height: H, loop: 0 });
  const regression = (diffAdap.length / diffFixed.length - 1) * 100;
  console.log('  Diff fixed:    ' + diffFixed.length + 'B');
  console.log('  Diff adaptive: ' + diffAdap.length + 'B');
  console.log('  Regression:    ' + regression.toFixed(1) + '% (target ≤5%)');
  ok(regression <= 5, 'screen recording diff regression ≤5% (got ' + regression.toFixed(1) + '%)');
}

// ---- 6. 透明 round-trip ----
console.log('[6] 透明像素 round-trip');
{
  const W = 32, H = 32;
  const f0 = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { f0[i * 4] = 255; f0[i * 4 + 3] = 255; }
  // Erase center
  for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) {
    const i = (y * W + x) * 4;
    f0[i] = 0; f0[i + 1] = 0; f0[i + 2] = 0; f0[i + 3] = 0;
  }
  const f1 = new Uint8Array(f0);
  // Add a blue square
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const i = (y * W + x) * 4;
    f1[i] = 0; f1[i + 1] = 0; f1[i + 2] = 255; f1[i + 3] = 255;
  }
  const gif = buildGIFDiffAdaptive(
    [{ width: W, height: H, rgba: f0, delayCs: 10 },
     { width: W, height: H, rgba: f1, delayCs: 10 }],
    { width: W, height: H, loop: 0 }
  );
  const decoded = decodeGif(gif.buffer);
  const centerIdx = (16 * W + 16) * 4;
  eq(decoded.frames[0].rgba[centerIdx + 3], 0, 'frame 0 center alpha=0');
  eq(decoded.frames[1].rgba[centerIdx + 3], 0, 'frame 1 center alpha=0 (stays transparent)');
  const cornerIdx = (2 * W + 2) * 4;
  eq(decoded.frames[1].rgba[cornerIdx + 2], 255, 'frame 1 corner B=255');
  eq(decoded.frames[1].rgba[cornerIdx + 3], 255, 'frame 1 corner alpha=255');
}

// ---- 7. minCodeSize 正确性（少量颜色时小调色板）----
console.log('[7] minCodeSize 处理');
{
  // 2-color image should produce small palette
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const c = i % 2 ? [255, 0, 0] : [0, 0, 255];
    rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
  }
  const pi = buildAdaptivePalette([{ width: W, height: H, rgba }], 255);
  console.log('  2-color image: tableSize=' + pi.tableSize + ' minCodeSize=' + pi.minCodeSize);
  ok(pi.tableSize <= 8, '2-color image uses small palette (≤8)');
  ok(pi.minCodeSize <= 3, '2-color image minCodeSize ≤3');

  const gif = buildGIFAdaptive([{ width: W, height: H, rgba, delayCs: 10 }], { width: W, height: H, loop: 0 });
  const decoded = decodeGif(gif.buffer);
  eq(decoded.frameCount, 1, 'small palette decodes 1 frame');
}

// ---- 8. 自适应差量 round-trip 帧数/延时 ----
console.log('[8] 自适应差量 round-trip 帧数/延时');
{
  const W = 48, H = 48;
  const delays = [5, 10, 15, 20, 25];
  const frames = delays.map((d, f) => {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = (x * 5 + f * 30) % 256;
      rgba[i + 1] = (y * 5 + f * 20) % 256;
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
    return { width: W, height: H, rgba, delayCs: d };
  });
  const gif = buildGIFDiffAdaptive(frames, { width: W, height: H, loop: 0 });
  const decoded = decodeGif(gif.buffer);
  eq(decoded.frameCount, 5, 'frame count preserved');
  for (let f = 0; f < 5; f++) {
    eq(decoded.frames[f].delayMs, delays[f] * 10, 'frame ' + f + ' delay preserved');
    eq(decoded.frames[f].rgba.length, W * H * 4, 'frame ' + f + ' dimensions correct');
  }
}

// ---- 9. 调色板查找网格正确性 ----
console.log('[9] 调色板查找网格');
{
  const palette = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
  const grid = buildLookupGrid(palette);
  eq(grid.length, 32768, 'grid is 32x32x32 = 32768 entries');
  // Black should map to palette[0]
  const blackIdx = ((0 >> 3) << 10) | ((0 >> 3) << 5) | (0 >> 3);
  eq(palette[grid[blackIdx]][0], 0, 'black maps to dark color');
  // Red should map to palette[1]
  const redIdx = ((0 >> 3) << 10) | ((255 >> 3) << 5) | (0 >> 3);
  eq(palette[grid[redIdx]][0], 255, 'red maps to red');
}

// ---- 10. 无结构性错误（多帧无花屏/错位）----
console.log('[10] 多帧无结构性错误');
{
  const W = 64, H = 64;
  const frames = makeGradient(W, H, 10);
  const gif = buildGIFAdaptive(frames, { width: W, height: H, loop: 0 });
  const decoded = decodeGif(gif.buffer);
  eq(decoded.frameCount, 10, '10 frames decoded');
  // Check no frame has unexpected dimensions
  for (let f = 0; f < 10; f++) {
    ok(decoded.frames[f].rgba.length === W * H * 4, 'frame ' + f + ' correct size');
  }
  // Check frame indices are sequential
  for (let f = 0; f < 10; f++) {
    eq(decoded.frames[f].index, f, 'frame ' + f + ' index correct');
  }
}

// ---- Results ----
console.log('\n=== Results ===');
console.log('PASS: ' + pass);
console.log('FAIL: ' + fail);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
  process.exit(1);
} else {
  console.log('\n✓ All adaptive palette tests passed.');
}
