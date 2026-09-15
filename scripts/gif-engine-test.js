// scripts/gif-engine-test.js
// 引擎综合测试：压缩、特效、pipeline 端到端、fuzz D 类（随机编辑操作序列）。
// 零 npm 依赖，node 直接运行。
//
// 运行：node scripts/gif-engine-test.js [fuzzIterations]

'use strict';

const path = require('path');
const { decodeGif } = require(path.join(__dirname, '..', 'utils', 'gif-decoder.js'));
const { buildGIF, buildGIFDiff, buildGIFAdaptive, buildGIFDiffAdaptive } = require(path.join(__dirname, '..', 'utils', 'gif-encoder.js'));
const { compressGif, scaleFrame, sampleFrames } = require(path.join(__dirname, '..', 'utils', 'gif-compress.js'));
const { glowEffect, glitchEffect, vignetteEffect, fadeFrame } = require(path.join(__dirname, '..', 'utils', 'gif-effects.js'));
const { cropFrame, cloneFrame, eraseCircle } = require(path.join(__dirname, '..', 'utils', 'gif-frame-ops.js'));
const report = require(path.join(__dirname, '..', 'utils', 'gif-report.js'));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (expected=' + b + ', actual=' + a + ')'); }

function makeSolidFrame(w, h, r, g, b, a) {
  a = a === undefined ? 255 : a;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a; }
  return rgba;
}

function makeGradient(w, h, seed) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = (x * 4 + seed * 20) % 256;
    rgba[i + 1] = (y * 4 + seed * 10) % 256;
    rgba[i + 2] = ((x + y) * 2 + seed * 15) % 256;
    rgba[i + 3] = 255;
  }
  return rgba;
}

function makePhoto(w, h, seed) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = Math.round(128 + 127 * Math.sin(x / 20 + seed));
    rgba[i + 1] = Math.round(128 + 127 * Math.sin(y / 25 + seed * 0.5));
    rgba[i + 2] = Math.round(128 + 127 * Math.cos((x + y) / 30));
    rgba[i + 3] = 255;
  }
  return rgba;
}

console.log('=== GIF Engine Comprehensive Tests ===\n');

// ===================================================================
// 1. 压缩引擎
// ===================================================================
console.log('[1] GIF 压缩');

// 1a. 压缩到目标体积
{
  const W = 120, H = 120;
  const frames = [];
  for (let f = 0; f < 20; f++) {
    frames.push({ rgba: makeGradient(W, H, f), delayMs: 50, width: W, height: H });
  }
  const original = buildGIFDiff(frames.map(f => ({ width: W, height: H, rgba: f.rgba, delayCs: 5 })),
    { width: W, height: H, loop: 0, dither: false });
  const target = Math.round(original.length * 0.4); // 目标 40%
  const result = compressGif(frames, W, H, target, { loop: 0 });
  console.log('  Original: ' + original.length + 'B, target: ' + target + 'B, compressed: ' + result.compressedSize + 'B');
  console.log('  Strategy: ' + result.strategy + ', met: ' + result.metTarget + ', attempts: ' + result.attempts);
  ok(result.compressedSize < original.length, 'compressed smaller than original');
  ok(result.bytes.length > 0, 'has output bytes');
  // 验证可解码
  const decoded = decodeGif(result.bytes.buffer);
  ok(decoded.frameCount >= 1, 'compressed GIF decodable');
  eq(decoded.width, result.width, 'decoded width matches');
  eq(decoded.height, result.height, 'decoded height matches');
}

// 1b. 已达标时不压缩
{
  const W = 16, H = 16;
  const frames = [{ rgba: makeSolidFrame(W, H, 255, 0, 0), delayMs: 100, width: W, height: H }];
  const result = compressGif(frames, W, H, 999999, { loop: 0 });
  eq(result.strategy, 'original', 'already meets target → original');
  eq(result.metTarget, true, 'met target');
  eq(result.attempts, 1, 'only 1 attempt');
}

// 1c. 压缩数据表（3 类样本 × 3 档目标）
console.log('  [1c] Compression data table:');
const samples = [
  { name: 'gradient', make: (s) => makeGradient(100, 100, s), frames: 10 },
  { name: 'photo', make: (s) => makePhoto(100, 100, s), frames: 10 },
  { name: 'screen-rec', make: (s) => {
    const rgba = makeSolidFrame(100, 100, 100, 150, 200);
    for (let y = s * 5; y < s * 5 + 20 && y < 100; y++)
      for (let x = s * 3; x < s * 3 + 20 && x < 100; x++) {
        const i = (y * 100 + x) * 4;
        rgba[i] = s * 25 % 256; rgba[i + 1] = 200; rgba[i + 2] = 50;
      }
    return rgba;
  }, frames: 30 }
];
const targets = [0.7, 0.4, 0.2];
console.log('  | Sample | Target% | Result | Strategy | Frames | Met |');
console.log('  |---|---|---|---|---|---|');
for (const sample of samples) {
  const W = 100, H = 100;
  const frames = [];
  for (let f = 0; f < sample.frames; f++) {
    frames.push({ rgba: sample.make(f), delayMs: 50, width: W, height: H });
  }
  const orig = buildGIFDiff(frames.map(f => ({ width: W, height: H, rgba: f.rgba, delayCs: 5 })),
    { width: W, height: H, loop: 0, dither: false });
  for (const t of targets) {
    const targetBytes = Math.round(orig.length * t);
    const result = compressGif(frames, W, H, targetBytes, { loop: 0 });
    const pct = (result.compressedSize / orig.length * 100).toFixed(0) + '%';
    console.log('  | ' + sample.name + ' | ' + (t * 100) + '% | ' + pct + ' | ' +
      result.strategy + ' | ' + result.frameCount + ' | ' + (result.metTarget ? '✓' : 'best') + ' |');
  }
}

// ===================================================================
// 2. 帧特效
// ===================================================================
console.log('\n[2] 帧特效');

// 2a. glow
{
  const W = 32, H = 32;
  const rgba = makeSolidFrame(W, H, 0, 0, 0, 255);
  // 画一个白色方块产生边缘
  for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) {
    const i = (y * W + x) * 4;
    rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255;
  }
  const bbox = glowEffect(rgba, W, H, { intensity: 1.0, color: [0, 240, 255], threshold: 30 });
  ok(bbox !== null, 'glow returns bbox');
  // 边缘外的黑色像素应有发光色
  let glowPixels = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 1] > 150 && rgba[i + 2] > 150 && rgba[i] < 100) glowPixels++;
  }
  ok(glowPixels > 0, 'glow pixels present (' + glowPixels + ')');
}

// 2b. glitch
{
  const W = 32, H = 32;
  const rgba = makeGradient(W, H, 1);
  const before = new Uint8Array(rgba);
  glitchEffect(rgba, W, H, { seed: 42, intensity: 0.8 });
  let changed = 0;
  for (let i = 0; i < rgba.length; i++) if (rgba[i] !== before[i]) changed++;
  ok(changed > 0, 'glitch modifies pixels');
  // alpha should stay 255 for opaque pixels
  let alphaOk = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) alphaOk = false;
  ok(alphaOk, 'glitch preserves alpha');
}

// 2c. vignette
{
  const W = 32, H = 32;
  const rgba = makeSolidFrame(W, H, 200, 200, 200, 255);
  vignetteEffect(rgba, W, H, { intensity: 0.8, radius: 0.5 });
  // 中心应比边缘亮
  const center = (16 * W + 16) * 4;
  const corner = (0 * W + 0) * 4;
  ok(rgba[center] > rgba[corner], 'center brighter than corner');
  ok(rgba[corner] < 200, 'corner darkened');
}

// 2d. fade
{
  const W = 8, H = 8;
  const rgba = makeSolidFrame(W, H, 255, 255, 255, 255);
  fadeFrame(rgba, W, H, 0, 5, 0, 10); // 第 0 帧，淡入 5 帧
  // alpha 应该约为 1/5 * 255 ≈ 51
  const alpha = rgba[3];
  ok(alpha < 100, 'fade-in reduces alpha (got ' + alpha + ')');
  ok(alpha > 0, 'fade-in not fully transparent');
}

// ===================================================================
// 3. Pipeline 端到端
// ===================================================================
console.log('\n[3] Pipeline 端到端');
{
  const W = 64, H = 64;
  // 生成多帧
  const originalFrames = [];
  for (let f = 0; f < 8; f++) {
    originalFrames.push({ rgba: makeGradient(W, H, f), delayMs: 100, width: W, height: H });
  }

  // 编码 → 解码（模拟源 GIF）
  const srcGif = buildGIFDiff(
    originalFrames.map(f => ({ width: W, height: H, rgba: f.rgba, delayCs: 10 })),
    { width: W, height: H, loop: 0, dither: false }
  );
  const decoded = decodeGif(srcGif.buffer);

  // 施加编辑操作序列
  let frames = decoded.frames.map(f => ({ rgba: f.rgba, delayMs: f.delayMs, width: decoded.width, height: decoded.height }));

  // 3a. 裁剪
  const CW = 32, CH = 32;
  for (const f of frames) {
    f.rgba = cropFrame(f.rgba, decoded.width, decoded.height, 16, 16, CW, CH);
    f.width = CW; f.height = CH;
  }
  eq(frames[0].rgba.length, CW * CH * 4, 'crop changes frame size');

  // 3b. 擦除（第一帧）
  eraseCircle(frames[0].rgba, CW, CH, 16, 16, 8);
  eq(frames[0].rgba[(16 * CW + 16) * 4 + 3], 0, 'erase sets alpha=0');

  // 3c. 暗角特效（第二帧）
  vignetteEffect(frames[1].rgba, CW, CH, { intensity: 0.5 });

  // 3d. 调速（延时×2）
  for (const f of frames) f.delayMs = f.delayMs * 2;

  // 3e. 倒放
  frames.reverse();

  // 3f. 删帧（保留 5 帧）
  frames = frames.slice(0, 5);

  // 导出
  const outGif = buildGIFDiff(
    frames.map(f => ({ width: CW, height: CH, rgba: f.rgba, delayCs: Math.max(2, Math.round(f.delayMs / 10)) })),
    { width: CW, height: CH, loop: 0, dither: false }
  );

  // 再解码验证
  const result = decodeGif(outGif.buffer);
  eq(result.frameCount, 5, 'pipeline output frame count');
  eq(result.width, CW, 'pipeline output width');
  eq(result.height, CH, 'pipeline output height');
  // 延时应翻倍（100ms → 200ms）
  // 注意：倒放后第一帧是原最后一帧，延时也翻倍
  for (let i = 0; i < 5; i++) {
    ok(result.frames[i].delayMs > 100, 'frame ' + i + ' delay doubled (got ' + result.frames[i].delayMs + ')');
  }
  // 透明保持（原第一帧现在是最后一帧）
  const lastFrame = result.frames[4].rgba;
  // 注意：差量编码后透明可能保持
  ok(lastFrame.length === CW * CH * 4, 'last frame correct size');
  console.log('  Pipeline: 64x64x8 → crop 32x32 → erase → vignette → 2x speed → reverse → 5 frames → OK');
}

// ===================================================================
// 4. 压缩 + 特效 pipeline
// ===================================================================
console.log('\n[4] 压缩 + 特效 pipeline');
{
  const W = 80, H = 80;
  const frames = [];
  for (let f = 0; f < 10; f++) {
    let rgba = makePhoto(W, H, f);
    if (f % 3 === 0) glowEffect(rgba, W, H, { intensity: 0.4 });
    if (f % 3 === 1) vignetteEffect(rgba, W, H, { intensity: 0.3 });
    frames.push({ rgba, delayMs: 50, width: W, height: H });
  }
  const result = compressGif(frames, W, H, 5000, { loop: 0 });
  const decoded = decodeGif(result.bytes.buffer);
  ok(decoded.frameCount >= 1, 'compressed+effects decodable');
  console.log('  Compressed: ' + result.originalSize + 'B → ' + result.compressedSize + 'B (' +
    result.strategy + ', ' + decoded.frameCount + ' frames)');
}

// ===================================================================
// 5. Fuzz D 类：随机编辑操作序列
// ===================================================================
console.log('\n[5] Fuzz D 类：随机编辑操作序列');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGradientGif(rng, W, H, numFrames) {
  const frames = [];
  for (let f = 0; f < numFrames; f++) {
    const rgba = new Uint8Array(W * H * 4);
    const seed = Math.floor(rng() * 100);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = (x * 4 + seed) % 256;
      rgba[i + 1] = (y * 4 + f * 10) % 256;
      rgba[i + 2] = ((x + y) * 2 + f * 5) % 256;
      rgba[i + 3] = 255;
    }
    frames.push({ rgba, delayMs: 20 + Math.floor(rng() * 100), width: W, height: H });
  }
  return frames;
}

function runFuzzD(iterations, seed) {
  let fuzzPass = 0, fuzzFail = 0;
  const fuzzFailures = [];
  const rng = mulberry32(seed);

  for (let iter = 0; iter < iterations; iter++) {
    const W = 16 + Math.floor(rng() * 48);
    const H = 16 + Math.floor(rng() * 48);
    const numFrames = 2 + Math.floor(rng() * 8);
    let frames = randomGradientGif(mulberry32(seed + iter * 7919), W, H, numFrames);
    let curW = W, curH = H;

    try {
      // 随机操作序列
      const numOps = 1 + Math.floor(rng() * 5);
      for (let op = 0; op < numOps; op++) {
        const opType = Math.floor(rng() * 6);
        switch (opType) {
          case 0: { // 裁剪
            const cw = 16 + Math.floor(rng() * (curW - 16));
            const ch = 16 + Math.floor(rng() * (curH - 16));
            const cx = Math.floor(rng() * (curW - cw));
            const cy = Math.floor(rng() * (curH - ch));
            for (const f of frames) {
              f.rgba = cropFrame(f.rgba, curW, curH, cx, cy, cw, ch);
            }
            curW = cw; curH = ch;
            break;
          }
          case 1: { // 擦除
            const fi = Math.floor(rng() * frames.length);
            const ex = Math.floor(rng() * curW);
            const ey = Math.floor(rng() * curH);
            const er = 2 + Math.floor(rng() * 8);
            eraseCircle(frames[fi].rgba, curW, curH, ex, ey, er);
            break;
          }
          case 2: { // 暗角
            const fi = Math.floor(rng() * frames.length);
            vignetteEffect(frames[fi].rgba, curW, curH, { intensity: 0.3 + rng() * 0.5 });
            break;
          }
          case 3: { // 调速
            const factor = [0.5, 1, 2][Math.floor(rng() * 3)];
            for (const f of frames) f.delayMs = Math.round(f.delayMs / factor);
            break;
          }
          case 4: { // 倒放
            frames.reverse();
            break;
          }
          case 5: { // 删帧
            if (frames.length > 2) {
              const idx = Math.floor(rng() * frames.length);
              frames.splice(idx, 1);
            }
            break;
          }
        }
      }

      // 导出
      const encFrames = frames.map(f => ({
        width: curW, height: curH, rgba: f.rgba,
        delayCs: Math.max(2, Math.round(f.delayMs / 10))
      }));
      const gif = buildGIFDiff(encFrames, { width: curW, height: curH, loop: 0, dither: false });

      // 再解码验证不变量
      const decoded = decodeGif(gif.buffer);
      if (decoded.frameCount !== frames.length) {
        fuzzFail++;
        fuzzFailures.push('iter=' + iter + ' frameCount mismatch: ' + decoded.frameCount + ' vs ' + frames.length);
        continue;
      }
      if (decoded.width !== curW || decoded.height !== curH) {
        fuzzFail++;
        fuzzFailures.push('iter=' + iter + ' dimension mismatch');
        continue;
      }
      for (let i = 0; i < decoded.frames.length; i++) {
        if (decoded.frames[i].rgba.length !== curW * curH * 4) {
          fuzzFail++;
          fuzzFailures.push('iter=' + iter + ' frame ' + i + ' rgba length wrong');
          break;
        }
      }
      fuzzPass++;
    } catch (e) {
      fuzzFail++;
      fuzzFailures.push('iter=' + iter + ' EXCEPTION: ' + e.message);
    }
  }
  return { pass: fuzzPass, fail: fuzzFail, failures: fuzzFailures };
}

const fuzzIterations = parseInt(process.argv[2]) || 500;
const fuzzResult = runFuzzD(fuzzIterations, 20260908);
console.log('  Fuzz D: ' + fuzzResult.pass + ' pass / ' + fuzzResult.fail + ' fail (' + fuzzIterations + ' iterations)');
if (fuzzResult.fail > 0) {
  fuzzResult.failures.slice(0, 10).forEach(f => console.error('    ' + f));
}
ok(fuzzResult.fail === 0, 'fuzz D all pass');

// 再跑 2 个种子
for (const seed of [42, 999]) {
  const r = runFuzzD(200, seed);
  ok(r.fail === 0, 'fuzz D seed=' + seed + ' all pass (' + r.pass + '/200)');
}

// ===================================================================
// 6. Pipeline 报告断言
// ===================================================================
console.log('\n[6] Pipeline 报告断言');
{
  // 模拟导出流程：解码→编辑→编码→记录报告
  const W = 48, H = 48;
  const srcFrames = [];
  for (let f = 0; f < 6; f++) {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = (f * 40) % 256; rgba[i + 1] = (x * 5) % 256; rgba[i + 2] = (y * 5) % 256; rgba[i + 3] = 255;
    }
    srcFrames.push({ width: W, height: H, rgba, delayMs: 100 });
  }

  // 编辑：裁剪 + 调速
  const CW = 32, CH = 32;
  const edited = srcFrames.map(f => ({
    rgba: cropFrame(f.rgba, W, H, 8, 8, CW, CH),
    delayMs: f.delayMs / 2,
    width: CW, height: CH
  }));

  // 编码
  const encFrames = edited.map(f => ({
    width: CW, height: CH, rgba: f.rgba,
    delayCs: Math.max(2, Math.round(f.delayMs / 10))
  }));
  const gif = buildGIFDiff(encFrames, { width: CW, height: CH, loop: 0, dither: false });

  // 再解码验证
  const decoded = decodeGif(gif.buffer);
  eq(decoded.width, CW, 'report pipeline: width');
  eq(decoded.height, CH, 'report pipeline: height');
  eq(decoded.frameCount, 6, 'report pipeline: frame count');

  // 记录报告
  let store = report.createStore();
  store = report.addRecord(store, {
    timestamp: Date.now(),
    tool: 'gifEditor',
    operations: ['crop', 'speed:2x'],
    sourceWidth: W, sourceHeight: H, sourceFrameCount: 6,
    sourceSize: 50000,
    outputSize: gif.length,
    outputWidth: CW, outputHeight: CH, outputFrameCount: 6,
    matchRate: 0.9,
    durationMs: 200,
    compressionStrategy: 'fixed'
  });

  // 断言报告数据与实际产物一致
  const agg = report.aggregate(store);
  eq(agg.totalExports, 1, 'report: 1 export');
  eq(agg.totalOutputBytes, gif.length, 'report: output size matches actual GIF');
  ok(agg.totalSourceBytes === 50000, 'report: source size recorded');
  ok(agg.averageMatchRate === 0.9, 'report: match rate recorded');

  // 摘要包含关键信息
  const summary = report.formatRecordSummary(store.records[0]);
  ok(summary.indexOf('crop') >= 0, 'report summary has operations');
  ok(summary.indexOf('speed:2x') >= 0, 'report summary has speed');

  // 多次导出后聚合
  for (let i = 0; i < 5; i++) {
    store = report.addRecord(store, {
      timestamp: Date.now() + i * 1000,
      tool: 'gifBatch',
      operations: ['compress'],
      sourceWidth: W, sourceHeight: H, sourceFrameCount: 6,
      sourceSize: 40000 + i * 1000,
      outputSize: 15000 + i * 500,
      outputWidth: CW, outputHeight: CH, outputFrameCount: 5,
      matchRate: 0.8 + i * 0.02,
      durationMs: 100 + i * 20,
      compressionStrategy: 'scale0.75-step2'
    });
  }
  const agg2 = report.aggregate(store);
  eq(agg2.totalExports, 6, 'report: 6 exports total');
  ok(agg2.toolCounts.gifBatch === 5, 'report: tool counts');
  ok(agg2.toolCounts.gifEditor === 1, 'report: tool counts 2');
  ok(agg2.totalSavedBytes > 0, 'report: savings calculated');
  ok(agg2.averageCompressionRatio < 1, 'report: compression ratio < 1');
  console.log('  Report aggregation: ' + agg2.totalExports + ' exports, ' +
    'saved ' + report.formatBytes(agg2.totalSavedBytes) +
    ', avg ratio ' + (agg2.averageCompressionRatio * 100).toFixed(1) + '%');
}

// ===================================================================
// 7. Fuzz E 类：多次编辑导出后报告聚合一致性
// ===================================================================
console.log('\n[7] Fuzz E 类：多次导出报告聚合一致性');

function runFuzzE(iterations, seed) {
  const rng = mulberry32(seed);
  let ePass = 0, eFail = 0;
  for (let iter = 0; iter < iterations; iter++) {
    try {
      let store = report.createStore();
      const numExports = 1 + Math.floor(rng() * 8);
      let expectedTotal = 0;
      let expectedSource = 0;
      let expectedMatchSum = 0;
      let expectedMatchCount = 0;
      let expectedDuration = 0;
      const expectedTools = {};

      for (let e = 0; e < numExports; e++) {
        const tool = rng() < 0.5 ? 'gifEditor' : 'gifBatch';
        const sourceSize = 1000 + Math.floor(rng() * 100000);
        const outputSize = Math.floor(sourceSize * (0.1 + rng() * 0.8));
        const matchRate = rng() < 0.3 ? 0 : 0.5 + rng() * 0.5;
        const duration = 50 + Math.floor(rng() * 2000);
        const strategy = ['original', 'scale0.75-step2', 'scale0.5-step3'][Math.floor(rng() * 3)];

        store = report.addRecord(store, {
          timestamp: 1000000 + iter * 100000 + e * 1000,
          tool,
          operations: ['op' + Math.floor(rng() * 5)],
          sourceWidth: 100, sourceHeight: 100, sourceFrameCount: 10,
          sourceSize, outputSize,
          outputWidth: 50, outputHeight: 50, outputFrameCount: 8,
          matchRate, durationMs: duration,
          compressionStrategy: strategy
        });

        expectedTotal += outputSize;
        expectedSource += sourceSize;
        if (matchRate > 0) { expectedMatchSum += matchRate; expectedMatchCount++; }
        expectedDuration += duration;
        expectedTools[tool] = (expectedTools[tool] || 0) + 1;
      }

      const agg = report.aggregate(store);
      if (agg.totalExports !== numExports) { eFail++; continue; }
      if (agg.totalOutputBytes !== expectedTotal) { eFail++; continue; }
      if (agg.totalSourceBytes !== expectedSource) { eFail++; continue; }
      if (Math.abs(agg.averageMatchRate - (expectedMatchCount > 0 ? expectedMatchSum / expectedMatchCount : 0)) > 0.001) { eFail++; continue; }
      if (Math.abs(agg.averageDurationMs - expectedDuration / numExports) > 0.01) { eFail++; continue; }
      let toolOk = true;
      for (const t of Object.keys(expectedTools)) {
        if (agg.toolCounts[t] !== expectedTools[t]) { toolOk = false; break; }
      }
      if (!toolOk) { eFail++; continue; }
      ePass++;
    } catch (e) {
      eFail++;
    }
  }
  return { pass: ePass, fail: eFail };
}

const fuzzEIterations = parseInt(process.argv[3]) || 300;
const fuzzEResult = runFuzzE(fuzzEIterations, 20260907);
console.log('  Fuzz E: ' + fuzzEResult.pass + ' pass / ' + fuzzEResult.fail + ' fail (' + fuzzEIterations + ' iterations)');
ok(fuzzEResult.fail === 0, 'fuzz E all pass');

// 额外种子
for (const seed of [777, 31415]) {
  const r = runFuzzE(100, seed);
  ok(r.fail === 0, 'fuzz E seed=' + seed + ' all pass (' + r.pass + '/100)');
}

// ===================================================================
// Results
// ===================================================================
console.log('\n=== Results ===');
console.log('PASS: ' + pass);
console.log('FAIL: ' + fail);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
  process.exit(1);
} else {
  console.log('\n✓ All engine tests passed.');
}
