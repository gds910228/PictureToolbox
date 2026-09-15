// scripts/gif-adv-test.js
// GIF 进阶编辑能力自测（零 npm 依赖，node 直接运行）。
// 覆盖：裁剪像素重排、擦除透明、透明经差量导出保持、裁剪后导出帧数/延时/尺寸、九宫格定位。
//
// 运行：node scripts/gif-adv-test.js

'use strict';

const path = require('path');
const {
  cropFrame, cloneFrame, eraseCircle, snapshotRect, restoreRect,
  nineGridPosition, measureText
} = require(path.join(__dirname, '..', 'utils', 'gif-frame-ops.js'));
const { decodeGif } = require(path.join(__dirname, '..', 'utils', 'gif-decoder.js'));
const { buildGIF, buildGIFDiff } = require(path.join(__dirname, '..', 'utils', 'gif-encoder.js'));

let pass = 0, fail = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; failures.push(msg); console.error('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (expected=' + b + ', actual=' + a + ')'); }

function makeSolidFrame(w, h, r, g, b, a) {
  a = a === undefined ? 255 : a;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return rgba;
}

console.log('=== GIF Advanced Editing Tests ===\n');

// ---- 1. cropFrame 像素正确性 ----
console.log('[1] cropFrame 像素重排');
{
  // 4x4 frame, each pixel unique color = its index
  const W = 4, H = 4;
  const src = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    src[i * 4] = i; src[i * 4 + 1] = i; src[i * 4 + 2] = i; src[i * 4 + 3] = 255;
  }
  // Crop (1,1) to (3,3) → 2x2
  const cropped = cropFrame(src, W, H, 1, 1, 2, 2);
  eq(cropped.length, 2 * 2 * 4, 'cropped length = 16');
  // Pixel (0,0) in cropped = src (1,1) = index 5
  eq(cropped[0], 5, 'cropped[0,0].R = 5 (src index 5)');
  // Pixel (1,1) in cropped = src (2,2) = index 10
  eq(cropped[12], 10, 'cropped[1,1].R = 10 (src index 10)');
}

// ---- 2. cropFrame 边界 clamp ----
console.log('[2] cropFrame 边界 clamp');
{
  const W = 8, H = 8;
  const src = makeSolidFrame(W, H, 100, 150, 200);
  // Request out-of-bounds crop, should clamp
  const cropped = cropFrame(src, W, H, 6, 6, 10, 10);
  eq(cropped.length, 2 * 2 * 4, 'clamped crop = 2x2');
  eq(cropped[0], 100, 'clamped pixel R=100');
  eq(cropped[3], 255, 'clamped pixel A=255');
}

// ---- 3. cropFrame 全帧裁剪 ----
console.log('[3] cropFrame 全帧裁剪');
{
  const W = 16, H = 16;
  const src = makeSolidFrame(W, H, 10, 20, 30);
  const cropped = cropFrame(src, W, H, 0, 0, W, H);
  eq(cropped.length, W * H * 4, 'full crop same length');
  let identical = true;
  for (let i = 0; i < src.length; i++) if (src[i] !== cropped[i]) { identical = false; break; }
  ok(identical, 'full crop pixel-identical');
}

// ---- 4. cloneFrame 深拷贝 ----
console.log('[4] cloneFrame 深拷贝');
{
  const src = makeSolidFrame(4, 4, 1, 2, 3);
  const clone = cloneFrame(src);
  ok(clone !== src, 'clone is different object');
  eq(clone.length, src.length, 'clone same length');
  clone[0] = 99;
  eq(src[0], 1, 'modifying clone does not affect source');
}

// ---- 5. eraseCircle 擦除为透明 ----
console.log('[5] eraseCircle 擦除为透明');
{
  const W = 20, H = 20;
  const frame = makeSolidFrame(W, H, 255, 0, 0, 255); // solid red
  const bbox = eraseCircle(frame, W, H, 10, 10, 5);
  ok(bbox !== null, 'returns bbox');
  // Center should be transparent
  const centerIdx = (10 * W + 10) * 4;
  eq(frame[centerIdx + 3], 0, 'center alpha = 0');
  eq(frame[centerIdx], 0, 'center R = 0');
  eq(frame[centerIdx + 1], 0, 'center G = 0');
  eq(frame[centerIdx + 2], 0, 'center B = 0');
  // Corner should still be opaque red
  const cornerIdx = (0 * W + 0) * 4;
  eq(frame[cornerIdx + 3], 255, 'corner alpha = 255');
  eq(frame[cornerIdx], 255, 'corner R = 255');
}

// ---- 6. eraseCircle 空擦除返回 null ----
console.log('[6] eraseCircle 完全在画布外返回 null');
{
  const frame = makeSolidFrame(10, 10, 255, 255, 255);
  const bbox = eraseCircle(frame, 10, 10, 100, 100, 5);
  eq(bbox, null, 'out-of-bounds erase returns null');
  eq(frame[3], 255, 'no pixels modified');
}

// ---- 7. snapshotRect / restoreRect 撤销 ----
console.log('[7] snapshotRect/restoreRect 擦除撤销');
{
  const W = 20, H = 20;
  const frame = makeSolidFrame(W, H, 0, 255, 0, 255);
  // Snapshot center region
  const snap = snapshotRect(frame, W, H, 5, 5, 10, 10);
  eq(snap.w, 10, 'snapshot width = 10');
  eq(snap.h, 10, 'snapshot height = 10');
  eq(snap.data.length, 10 * 10 * 4, 'snapshot data length');
  // Erase
  eraseCircle(frame, W, H, 10, 10, 4);
  eq(frame[(10 * W + 10) * 4 + 3], 0, 'erased center alpha=0');
  // Restore
  restoreRect(frame, W, snap);
  eq(frame[(10 * W + 10) * 4 + 3], 255, 'restored center alpha=255');
  eq(frame[(10 * W + 10) * 4 + 1], 255, 'restored center G=255');
}

// ---- 8. 透明经差量导出保持 alpha=0 ----
console.log('[8] 透明像素经 buildGIFDiff 导出→解码保持 alpha=0');
{
  const W = 32, H = 32;
  const frames = [];
  // Frame 0: solid blue
  const f0 = makeSolidFrame(W, H, 0, 0, 255, 255);
  frames.push({ width: W, height: H, rgba: f0, delayCs: 10 });
  // Frame 1: same blue, but center erased (transparent)
  const f1 = cloneFrame(f0);
  eraseCircle(f1, W, H, 16, 16, 8);
  frames.push({ width: W, height: H, rgba: f1, delayCs: 10 });
  // Frame 2: another change (red square)
  const f2 = cloneFrame(f1);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const i = ((y + 4) * W + (x + 4)) * 4;
    f2[i] = 255; f2[i + 1] = 0; f2[i + 2] = 0; f2[i + 3] = 255;
  }
  frames.push({ width: W, height: H, rgba: f2, delayCs: 10 });

  const gif = buildGIFDiff(frames, { width: W, height: H, loop: 0, dither: false });
  const decoded = decodeGif(gif.buffer);

  eq(decoded.frameCount, 3, '3 frames decoded');
  // Frame 1 center should be transparent (alpha=0)
  const centerIdx = (16 * W + 16) * 4;
  eq(decoded.frames[1].rgba[centerIdx + 3], 0, 'frame 1 center alpha=0 after round-trip');
  // Frame 1 corners should still be blue
  eq(decoded.frames[1].rgba[2], 255, 'frame 1 corner B=255');
  eq(decoded.frames[1].rgba[3], 255, 'frame 1 corner alpha=255');
  // Frame 2 should have red square + transparent center
  eq(decoded.frames[2].rgba[(4 * W + 4) * 4], 255, 'frame 2 red square R=255');
  eq(decoded.frames[2].rgba[centerIdx + 3], 0, 'frame 2 center still alpha=0');
}

// ---- 9. 透明经差量导出保持 alpha=0（单帧）----
console.log('[9] 透明像素经 buildGIFDiff 导出→解码保持 alpha=0');
{
  const W = 16, H = 16;
  const f0 = makeSolidFrame(W, H, 0, 255, 0, 255);
  eraseCircle(f0, W, H, 8, 8, 4);
  const gif = buildGIFDiff(
    [{ width: W, height: H, rgba: f0, delayCs: 10 }],
    { width: W, height: H, loop: 0, dither: false }
  );
  const decoded = decodeGif(gif.buffer);
  eq(decoded.frames[0].rgba[(8 * W + 8) * 4 + 3], 0, 'erased center alpha=0 (buildGIFDiff)');
}

// ---- 10. 裁剪后导出：帧数/延时不变，尺寸等于裁剪尺寸 ----
console.log('[10] 裁剪后导出帧数/延时/尺寸');
{
  const W = 64, H = 64;
  const srcFrames = [];
  const delays = [5, 10, 15, 20];
  for (let f = 0; f < 4; f++) {
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      rgba[i * 4] = (f * 50) % 256;
      rgba[i * 4 + 1] = (i * 3) % 256;
      rgba[i * 4 + 2] = 100;
      rgba[i * 4 + 3] = 255;
    }
    srcFrames.push({ rgba, delayMs: delays[f] * 10 });
  }
  // Crop to 32x32 at (16,16)
  const CW = 32, CH = 32;
  const croppedFrames = srcFrames.map(f => ({
    width: CW, height: CH,
    rgba: cropFrame(f.rgba, W, H, 16, 16, CW, CH),
    delayCs: Math.max(2, Math.round(f.delayMs / 10))
  }));
  const gif = buildGIFDiff(croppedFrames, { width: CW, height: CH, loop: 0, dither: false });
  const decoded = decodeGif(gif.buffer);
  eq(decoded.width, CW, 'decoded width = crop width');
  eq(decoded.height, CH, 'decoded height = crop height');
  eq(decoded.frameCount, 4, 'frame count preserved');
  for (let f = 0; f < 4; f++) {
    eq(decoded.frames[f].rgba.length, CW * CH * 4, 'frame ' + f + ' rgba size = crop size');
    eq(decoded.frames[f].delayMs, delays[f] * 10, 'frame ' + f + ' delay preserved');
  }
}

// ---- 11. 九宫格定位 ----
console.log('[11] nineGridPosition 九宫格定位');
{
  // 100x100 canvas, 20x10 text
  const positions = {
    tl: { x: 12, y: 12 },
    tc: { x: 40, y: 12 },
    tr: { x: 68, y: 12 },
    ml: { x: 12, y: 45 },
    mc: { x: 40, y: 45 },
    mr: { x: 68, y: 45 },
    bl: { x: 12, y: 78 },
    bc: { x: 40, y: 78 },
    br: { x: 68, y: 78 }
  };
  for (const [pos, expected] of Object.entries(positions)) {
    const result = nineGridPosition(100, 100, 20, 10, pos, 12);
    eq(result.x, expected.x, pos + ' x = ' + expected.x);
    eq(result.y, expected.y, pos + ' y = ' + expected.y);
  }
}

// ---- 12. measureText 文本测量 ----
console.log('[12] measureText 测量');
{
  const m = measureText('Hello', 20);
  ok(m.w > 0, 'width > 0');
  eq(m.h, 24, 'single line height = 20*1.2 = 24');
  eq(m.lines.length, 1, 'one line');

  const m2 = measureText('Line1\nLine2', 20);
  eq(m2.lines.length, 2, 'two lines');
  eq(m2.h, 48, 'two line height = 48');

  // Chinese chars should be wider
  const mCn = measureText('中文', 20);
  const mEn = measureText('AB', 20);
  ok(mCn.w > mEn.w, 'Chinese text wider than ASCII at same font size');
}

// ---- 13. 局部颜色变化差量编码体积应小于全帧（复杂背景）----
console.log('[13] 局部变化差量编码体积（复杂背景）');
{
  const W = 64, H = 64;
  // 复杂背景（高熵，LZW 压缩率低，差量优势明显）
  const f0 = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    f0[i * 4] = (i * 7 + 13) % 256;
    f0[i * 4 + 1] = (i * 11 + 29) % 256;
    f0[i * 4 + 2] = (i * 3 + 41) % 256;
    f0[i * 4 + 3] = 255;
  }
  // 局部区域颜色变化（不涉及 alpha 变化，避免触发 disposal=2 全帧回退）
  const f1 = cloneFrame(f0);
  for (let y = 28; y < 36; y++) for (let x = 28; x < 36; x++) {
    const i = (y * W + x) * 4;
    f1[i] = 255; f1[i + 1] = 0; f1[i + 2] = 0; f1[i + 3] = 255;
  }
  const fullGif = buildGIF(
    [{ width: W, height: H, rgba: f0, delayCs: 10 },
     { width: W, height: H, rgba: f1, delayCs: 10 }],
    { width: W, height: H, loop: 0, dither: false }
  );
  const diffGif = buildGIFDiff(
    [{ width: W, height: H, rgba: f0, delayCs: 10 },
     { width: W, height: H, rgba: f1, delayCs: 10 }],
    { width: W, height: H, loop: 0, dither: false }
  );
  ok(diffGif.length < fullGif.length,
    'diff (' + diffGif.length + 'B) < full (' + fullGif.length + 'B), saved ' +
    ((1 - diffGif.length / fullGif.length) * 100).toFixed(1) + '%');
}

// ---- 14. 裁剪 + 擦除 + 文字颜色 round-trip ----
console.log('[14] 裁剪+擦除组合 round-trip 无结构性错误');
{
  const W = 40, H = 40;
  // Create frame with distinct colors
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    rgba[i] = x * 6; rgba[i + 1] = y * 6; rgba[i + 2] = 128; rgba[i + 3] = 255;
  }
  // Crop
  const cropped = cropFrame(rgba, W, H, 8, 8, 24, 24);
  // Erase center
  eraseCircle(cropped, 24, 24, 12, 12, 4);
  const gif = buildGIFDiff(
    [{ width: 24, height: 24, rgba: cropped, delayCs: 10 }],
    { width: 24, height: 24, loop: 0, dither: false }
  );
  const decoded = decodeGif(gif.buffer);
  eq(decoded.width, 24, 'width = 24');
  eq(decoded.height, 24, 'height = 24');
  eq(decoded.frameCount, 1, '1 frame');
  // Center should be transparent
  eq(decoded.frames[0].rgba[(12 * 24 + 12) * 4 + 3], 0, 'center alpha=0');
  // Corner should be opaque
  eq(decoded.frames[0].rgba[3], 255, 'corner alpha=255');
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
  console.log('\n✓ All advanced editing tests passed.');
}
