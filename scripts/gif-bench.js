// scripts/gif-bench.js
// 性能基准：640×640×60 帧 GIF 的 decode 与 encode 耗时（node 直接运行）。
//
// 运行：node scripts/gif-bench.js
//
// 同时输出差量编码（buildGIFDiff）与全帧编码（buildGIF）的体积对比数据表。

'use strict';

const path = require('path');
const { decodeGif } = require(path.join(__dirname, '..', 'pkgGif', 'utils', 'gif-decoder.js'));
const { buildGIF, buildGIFDiff, PALETTE } = require(path.join(__dirname, '..', 'pkgGif', 'utils', 'gif-encoder.js'));

function formatTime(ms) {
  if (ms < 1000) return ms.toFixed(1) + 'ms';
  return (ms / 1000).toFixed(3) + 's';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// 生成测试用合成帧（使用编码器 PALETTE 颜色以保证 round-trip 无损）
function makeFrames(W, H, count, type) {
  const frames = [];
  for (let f = 0; f < count; f++) {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (type === 'full') {
          // 全帧变化：每帧所有像素都变
          const c = PALETTE[(x + y + f * 37) % 216];
          rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2];
        } else if (type === 'local') {
          // 局部变化：小区域移动（屏幕录制式），块大小为帧的 ~10%
          const bg = PALETTE[100];
          rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2];
          const bw = Math.max(16, Math.round(W * 0.1));
          const bh = Math.max(16, Math.round(H * 0.1));
          const cx = (f * Math.round(bw * 0.4)) % (W - bw);
          const cy = (f * Math.round(bh * 0.3)) % (H - bh);
          if (x >= cx && x < cx + bw && y >= cy && y < cy + bh) {
            const c = PALETTE[(f * 13) % 216];
            rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2];
          }
        } else if (type === 'gradient') {
          // 渐变（中等变化）
          const c = PALETTE[((x / W * 5) | 0) * 36 + ((y / H * 5) | 0) * 6 + (f % 6)];
          rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2];
        }
        rgba[i + 3] = 255;
      }
    }
    frames.push({ width: W, height: H, rgba, delayCs: 5 });
  }
  return frames;
}

console.log('=== GIF Engine Performance Benchmark ===');
console.log('Node:', process.version);
console.log('Platform:', process.platform, process.arch);
console.log('');

// ---- 640×640×60 帧基准 ----
const BW = 640, BH = 640, BCOUNT = 60;
console.log('Generating ' + BW + 'x' + BH + 'x' + BCOUNT + ' test frames...');

const fullFrames = makeFrames(BW, BH, BCOUNT, 'full');
const localFrames = makeFrames(BW, BH, BCOUNT, 'local');
const gradientFrames = makeFrames(BW, BH, BCOUNT, 'gradient');

console.log('');

// 编码基准
console.log('--- Encode Benchmark (' + BW + 'x' + BH + 'x' + BCOUNT + ') ---');

let t0 = Date.now();
const fullGif = buildGIF(fullFrames, { width: BW, height: BH, loop: 0, dither: false });
let t1 = Date.now();
console.log('buildGIF (full change):    ' + formatTime(t1 - t0) + ' -> ' + formatSize(fullGif.length));

t0 = Date.now();
const fullDiffGif = buildGIFDiff(fullFrames, { width: BW, height: BH, loop: 0, dither: false });
t1 = Date.now();
console.log('buildGIFDiff (full change):' + formatTime(t1 - t0) + ' -> ' + formatSize(fullDiffGif.length));
console.log('  Regression: ' + ((fullDiffGif.length / fullGif.length - 1) * 100).toFixed(1) + '% (target <=10%)');

t0 = Date.now();
const localGif = buildGIF(localFrames, { width: BW, height: BH, loop: 0, dither: false });
t1 = Date.now();
console.log('buildGIF (local change):   ' + formatTime(t1 - t0) + ' -> ' + formatSize(localGif.length));

t0 = Date.now();
const localDiffGif = buildGIFDiff(localFrames, { width: BW, height: BH, loop: 0, dither: false });
t1 = Date.now();
console.log('buildGIFDiff (local change):' + formatTime(t1 - t0) + ' -> ' + formatSize(localDiffGif.length));
const localReduction = (1 - localDiffGif.length / localGif.length) * 100;
console.log('  Reduction: ' + localReduction.toFixed(1) + '% (target >=40%)');

t0 = Date.now();
const gradientGif = buildGIF(gradientFrames, { width: BW, height: BH, loop: 0, dither: false });
t1 = Date.now();
console.log('buildGIF (gradient):       ' + formatTime(t1 - t0) + ' -> ' + formatSize(gradientGif.length));

t0 = Date.now();
const gradientDiffGif = buildGIFDiff(gradientFrames, { width: BW, height: BH, loop: 0, dither: false });
t1 = Date.now();
console.log('buildGIFDiff (gradient):   ' + formatTime(t1 - t0) + ' -> ' + formatSize(gradientDiffGif.length));
console.log('  Reduction: ' + ((1 - gradientDiffGif.length / gradientGif.length) * 100).toFixed(1) + '%');

console.log('');

// 解码基准
console.log('--- Decode Benchmark (' + BW + 'x' + BH + 'x' + BCOUNT + ') ---');

t0 = Date.now();
const decodedFull = decodeGif(fullGif.buffer);
t1 = Date.now();
console.log('decodeGif (full change):    ' + formatTime(t1 - t0));
console.log('  Frames: ' + decodedFull.frameCount + ', target <=2s: ' + (t1 - t0 <= 2000 ? 'PASS' : 'FAIL'));

t0 = Date.now();
const decodedLocal = decodeGif(localDiffGif.buffer);
t1 = Date.now();
console.log('decodeGif (local diff):     ' + formatTime(t1 - t0));
console.log('  Frames: ' + decodedLocal.frameCount + ', target <=2s: ' + (t1 - t0 <= 2000 ? 'PASS' : 'FAIL'));

t0 = Date.now();
const decodedGradient = decodeGif(gradientGif.buffer);
t1 = Date.now();
console.log('decodeGif (gradient):       ' + formatTime(t1 - t0));

console.log('');

// ---- 差量编码数据表 ----
console.log('=== Diff Encoding Data Table ===');
console.log('');
console.log('| Sample Type | Dimensions | Frames | Full-frame | Diff-encoded | Reduction | Target | Status |');
console.log('|---|---|---|---|---|---|---|---|');

const samples = [
  { name: 'Local change (screen recording)', W: 640, H: 640, count: 60, type: 'local', targetReduction: 40 },
  { name: 'Full frame change', W: 640, H: 640, count: 60, type: 'full', targetRegression: 10 },
  { name: 'Gradient (medium change)', W: 640, H: 640, count: 60, type: 'gradient' },
  { name: 'Local change (small, 60 frames)', W: 240, H: 240, count: 60, type: 'local', targetReduction: 40 },
  { name: 'Full change (small)', W: 240, H: 240, count: 30, type: 'full', targetRegression: 10 }
];

for (const s of samples) {
  const frames = makeFrames(s.W, s.H, s.count, s.type);
  const full = buildGIF(frames, { width: s.W, height: s.H, loop: 0, dither: false });
  const diff = buildGIFDiff(frames, { width: s.W, height: s.H, loop: 0, dither: false });
  const reduction = ((1 - diff.length / full.length) * 100);
  const pct = reduction.toFixed(1) + '%';
  let status, target;
  if (s.targetReduction) {
    target = '>=' + s.targetReduction + '%';
    status = reduction >= s.targetReduction ? 'PASS' : 'FAIL';
  } else if (s.targetRegression) {
    target = '<=' + s.targetRegression + '% regress';
    status = reduction >= -s.targetRegression ? 'PASS' : 'FAIL';
  } else {
    target = 'N/A';
    status = 'INFO';
  }
  console.log('| ' + s.name + ' | ' + s.W + 'x' + s.H + ' | ' + s.count +
    ' | ' + formatSize(full.length) + ' | ' + formatSize(diff.length) +
    ' | ' + pct + ' | ' + target + ' | ' + status + ' |');
}

console.log('');

// ---- Round-trip 像素验证 ----
console.log('=== Round-trip Pixel Verification ===');
const rtFrames = makeFrames(480, 480, 20, 'local');
const rtGif = buildGIFDiff(rtFrames, { width: 480, height: 480, loop: 0, dither: false });
const rtDecoded = decodeGif(rtGif.buffer);
let totalCh = 0, badCh = 0, maxDiff = 0;
for (let f = 0; f < rtFrames.length; f++) {
  const orig = rtFrames[f].rgba;
  const rt = rtDecoded.frames[f].rgba;
  for (let i = 0; i < orig.length; i += 4) {
    if (orig[i + 3] === 255 && rt[i + 3] === 255) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(orig[i + c] - rt[i + c]);
        if (d > maxDiff) maxDiff = d;
        if (d > 8) badCh++;
        totalCh++;
      }
    }
  }
}
console.log('Max per-channel diff: ' + maxDiff);
console.log('Pixels with diff >8: ' + badCh + '/' + totalCh + ' (' + (badCh / totalCh * 100).toFixed(3) + '%)');
console.log('99% within 8: ' + (badCh / totalCh * 100 <= 1 ? 'PASS' : 'FAIL'));
console.log('No structural errors (frame count match): ' + (rtDecoded.frameCount === rtFrames.length ? 'PASS' : 'FAIL'));
