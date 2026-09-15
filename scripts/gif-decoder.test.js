// scripts/gif-decoder.test.js
// GIF 解码器自测脚本（零 npm 依赖，node 直接运行）。
//
// 运行：node scripts/gif-decoder.test.js
//
// 覆盖：
//   1. 基本 GCT 解码（颜色正确）
//   2. 局部颜色表（LCT 优先于 GCT）
//   3. 透明索引（alpha=0）
//   4. 隔行扫描（interlace 像素位置正确）
//   5. disposal 0/1/2（帧合成）
//   6. 帧延迟换算（1/100s → delayMs）
//   7. NETSCAPE 循环计数
//   8. 非法输入 throw
//   9. decode → buildGIF → decode round-trip
//  10. 多帧 round-trip（含 9→10→11→12 位码宽跨越）

'use strict';

const path = require('path');
const fs = require('fs');
const { decodeGif } = require(path.join(__dirname, '..', 'utils', 'gif-decoder.js'));
const { buildGIF, PALETTE, nearestIndex } = require(path.join(__dirname, '..', 'utils', 'gif-encoder.js'));

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passCount++;
  } else {
    failCount++;
    failures.push(msg);
    console.error('  ✗ FAIL: ' + msg);
  }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    passCount++;
  } else {
    failCount++;
    const m = msg + ' (expected=' + expected + ', actual=' + actual + ')';
    failures.push(m);
    console.error('  ✗ FAIL: ' + m);
  }
}

function assertArrayEq(actual, expected, msg) {
  if (actual.length !== expected.length) {
    failCount++;
    const m = msg + ' (length mismatch: expected=' + expected.length + ', actual=' + actual.length + ')';
    failures.push(m);
    console.error('  ✗ FAIL: ' + m);
    return;
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      failCount++;
      const m = msg + ' (at [' + i + ']: expected=' + expected[i] + ', actual=' + actual[i] + ')';
      failures.push(m);
      console.error('  ✗ FAIL: ' + m);
      return;
    }
  }
  passCount++;
}

function assertThrows(fn, expectedSubstr, msg) {
  try {
    fn();
    failCount++;
    const m = msg + ' (did not throw)';
    failures.push(m);
    console.error('  ✗ FAIL: ' + m);
  } catch (e) {
    if (expectedSubstr && e.message.indexOf(expectedSubstr) < 0) {
      failCount++;
      const m = msg + ' (threw "' + e.message + '", expected to contain "' + expectedSubstr + '")';
      failures.push(m);
      console.error('  ✗ FAIL: ' + m);
    } else {
      passCount++;
    }
  }
}

// ===================================================================
// 测试用 LZW 编码器（用于手工构造 GIF；与生产编码器同算法，可配置 minCodeSize）
// ===================================================================

function lzwEncodeTest(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  let codeSize = minCodeSize + 1;
  const dict = new Map();

  const out = [];
  let cur = 0, curBits = 0;
  function writeCode(code) {
    cur |= (code << curBits);
    curBits += codeSize;
    while (curBits >= 8) {
      out.push(cur & 0xff);
      cur = Math.floor(cur / 256);
      curBits -= 8;
    }
  }

  writeCode(clearCode);
  let phrase = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = (phrase << 8) | c;
    if (dict.has(key)) {
      phrase = dict.get(key);
    } else {
      writeCode(phrase);
      if (nextCode < 4096) {
        dict.set(key, nextCode);
        nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        writeCode(clearCode);
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
        dict.clear();
      }
      phrase = c;
    }
  }
  writeCode(phrase);
  writeCode(eoiCode);
  if (curBits > 0) out.push(cur & 0xff);
  return out;
}

// ===================================================================
// 手工 GIF 构造器
// ===================================================================

class GifBuilder {
  constructor(w, h, gctColors) {
    this.w = w;
    this.h = h;
    this.gct = gctColors; // array of [r,g,b], length must be power of 2
    this.loopCount = null; // null = no NETSCAPE, 0 = infinite, N = N times
    this.frames = [];
  }

  setLoop(n) { this.loopCount = n; return this; }

  // frame: { left, top, width, height, indices, palette?, interlace?, delayCs, disposal, transparentFlag, transIndex }
  addFrame(frame) {
    this.frames.push(frame);
    return this;
  }

  build() {
    const bytes = [];
    const u16 = (v) => { bytes.push(v & 0xff, (v >> 8) & 0xff); };
    const raw = (arr) => { for (let i = 0; i < arr.length; i++) bytes.push(arr[i]); };

    // Header
    raw([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    // Logical Screen Descriptor
    u16(this.w); u16(this.h);
    const gctSize = this.gct ? this.gct.length : 0;
    const gctBits = gctSize > 0 ? Math.round(Math.log2(gctSize)) - 1 : 0;
    let packed = 0;
    if (gctSize > 0) packed |= 0x80 | (gctBits & 0x07);
    bytes.push(packed, 0, 0);
    // GCT
    if (gctSize > 0) {
      for (let i = 0; i < gctSize; i++) {
        bytes.push(this.gct[i][0], this.gct[i][1], this.gct[i][2]);
      }
    }

    // NETSCAPE
    if (this.loopCount !== null) {
      raw([0x21, 0xFF, 0x0B]);
      raw([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]);
      raw([0x03, 0x01]);
      u16(this.loopCount & 0xffff);
      bytes.push(0x00);
    }

    for (const f of this.frames) {
      // GCE
      raw([0x21, 0xF9, 0x04]);
      const disp = (f.disposal || 0) & 0x07;
      let gcePacked = (disp << 2);
      if (f.transparentFlag) gcePacked |= 0x01;
      bytes.push(gcePacked);
      u16(f.delayCs || 0);
      bytes.push(f.transparentFlag ? (f.transIndex || 0) : 0);
      bytes.push(0x00);

      // Image Descriptor
      bytes.push(0x2C);
      u16(f.left || 0); u16(f.top || 0);
      u16(f.width); u16(f.height);
      let imgPacked = 0;
      if (f.interlace) imgPacked |= 0x40;
      if (f.palette) {
        imgPacked |= 0x80 | (Math.round(Math.log2(f.palette.length)) - 1) & 0x07;
      }
      bytes.push(imgPacked);

      // LCT
      if (f.palette) {
        for (let i = 0; i < f.palette.length; i++) {
          bytes.push(f.palette[i][0], f.palette[i][1], f.palette[i][2]);
        }
      }

      // LZW data
      const minCodeSize = f.minCodeSize || (gctSize > 0 ? Math.max(2, Math.round(Math.log2(gctSize))) : 2);
      const lzw = lzwEncodeTest(f.indices, minCodeSize);
      bytes.push(minCodeSize);
      let pos = 0;
      while (pos < lzw.length) {
        const chunk = Math.min(255, lzw.length - pos);
        bytes.push(chunk);
        for (let k = 0; k < chunk; k++) bytes.push(lzw[pos + k]);
        pos += chunk;
      }
      bytes.push(0x00);
    }

    bytes.push(0x3B);
    return new Uint8Array(bytes).buffer;
  }
}

// 标准 4 色调色板
const PAL4 = [
  [0, 0, 0],       // 0 black
  [255, 0, 0],     // 1 red
  [0, 255, 0],     // 2 green
  [0, 0, 255]      // 3 blue
];

// ===================================================================
// 测试用例
// ===================================================================

console.log('=== GIF Decoder Tests ===\n');

// ---- Test 1: 基本 GCT 解码 ----
console.log('[1] 基本 GCT 解码');
{
  // 2x2 image: red, green, blue, black
  const gif = new GifBuilder(2, 2, PAL4)
    .addFrame({ width: 2, height: 2, indices: [1, 2, 3, 0], minCodeSize: 2, delayCs: 5 })
    .build();
  const r = decodeGif(gif);
  assertEq(r.width, 2, 'width');
  assertEq(r.height, 2, 'height');
  assertEq(r.frameCount, 1, 'frameCount');
  assertEq(r.frames[0].delayMs, 50, 'delayMs = 5cs * 10');
  assertEq(r.frames[0].disposal, 0, 'disposal default 0');
  // pixel (0,0)=red, (1,0)=green, (0,1)=blue, (1,1)=black
  const rgba = r.frames[0].rgba;
  assertEq(rgba[0], 255, 'pixel(0,0) R');
  assertEq(rgba[1], 0, 'pixel(0,0) G');
  assertEq(rgba[2], 0, 'pixel(0,0) B');
  assertEq(rgba[3], 255, 'pixel(0,0) A');
  assertEq(rgba[4], 0, 'pixel(1,0) R');
  assertEq(rgba[5], 255, 'pixel(1,0) G');
  assertEq(rgba[8], 0, 'pixel(0,1) R');
  assertEq(rgba[9], 0, 'pixel(0,1) G');
  assertEq(rgba[10], 255, 'pixel(0,1) B');
  assertEq(rgba[12], 0, 'pixel(1,1) R');
  assertEq(rgba[15], 255, 'pixel(1,1) A (black is opaque)');
}

// ---- Test 2: LCT 优先于 GCT ----
console.log('[2] 局部颜色表（LCT 优先于 GCT）');
{
  const lct = [
    [255, 255, 255], // 0 white
    [255, 255, 0],   // 1 yellow
    [0, 255, 255],   // 2 cyan
    [255, 0, 255]    // 3 magenta
  ];
  const gif = new GifBuilder(2, 2, PAL4)
    .addFrame({ width: 2, height: 2, indices: [0, 1, 2, 3], palette: lct, minCodeSize: 2 })
    .build();
  const r = decodeGif(gif);
  const rgba = r.frames[0].rgba;
  assertEq(rgba[0], 255, 'LCT pixel(0,0) R (white)');
  assertEq(rgba[1], 255, 'LCT pixel(0,0) G (white)');
  assertEq(rgba[2], 255, 'LCT pixel(0,0) B (white)');
  assertEq(rgba[4], 255, 'LCT pixel(1,0) R (yellow)');
  assertEq(rgba[5], 255, 'LCT pixel(1,0) G (yellow)');
  assertEq(rgba[6], 0, 'LCT pixel(1,0) B (yellow)');
  assertEq(rgba[8], 0, 'LCT pixel(0,1) R (cyan)');
  assertEq(rgba[9], 255, 'LCT pixel(0,1) G (cyan)');
  assertEq(rgba[10], 255, 'LCT pixel(0,1) B (cyan)');
}

// ---- Test 3: 透明索引 ----
console.log('[3] 透明索引（alpha=0）');
{
  // 2x2: index 0 is transparent, others red
  const gif = new GifBuilder(2, 2, PAL4)
    .addFrame({
      width: 2, height: 2, indices: [0, 1, 1, 0],
      minCodeSize: 2,
      transparentFlag: true, transIndex: 0
    })
    .build();
  const r = decodeGif(gif);
  const rgba = r.frames[0].rgba;
  assertEq(rgba[3], 0, 'transparent pixel(0,0) alpha=0');
  assertEq(rgba[15], 0, 'transparent pixel(1,1) alpha=0');
  assertEq(rgba[7], 255, 'opaque pixel(1,0) alpha=255');
  assertEq(rgba[4], 255, 'opaque pixel(1,0) is red R');
}

// ---- Test 4: 隔行扫描 ----
console.log('[4] 隔行扫描（interlace）');
{
  // 8x8 interlaced. Create distinct colors per row so we can verify row mapping.
  const W = 8, H = 8;
  // GCT with 8 colors (3 bits -> minCodeSize=3? No, 8 colors needs 3 bits, minCodeSize=3?
  // Actually GIF minCodeSize = ceil(log2(colorCount)), but min is 2. 8 colors -> 3 bits.
  // Wait, the LZW min code size for 8 colors is 3. But we can also use a larger palette.
  // Let's use 16-color palette (4 bits) to keep it simple.
  const pal16 = [];
  for (let i = 0; i < 16; i++) pal16.push([i * 16, i * 16, i * 16]);

  // Non-interlaced reference: row y has all pixels = color index y
  const refIndices = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      refIndices.push(y); // each row is a solid color

  // For interlaced GIF, the LZW data is stored in interlaced row order:
  // pass 1: rows 0,4 (step 8), pass 2: rows 1,5 (step 8)? No.
  // Interlace passes: (0,8), (4,8), (2,4), (1,2)
  // The stored pixel order is: row0, row4, row1, row5, row2, row6, row3, row7
  // But each ROW's pixels are stored left-to-right.
  const interlacedIndices = [];
  const passes = [[0, 8], [4, 8], [2, 4], [1, 2]];
  for (const [start, step] of passes) {
    for (let y = start; y < H; y += step) {
      for (let x = 0; x < W; x++) {
        interlacedIndices.push(y); // color = row number
      }
    }
  }

  const gif = new GifBuilder(W, H, pal16)
    .addFrame({
      width: W, height: H,
      indices: interlacedIndices,
      interlace: true,
      minCodeSize: 4
    })
    .build();
  const r = decodeGif(gif);
  const rgba = r.frames[0].rgba;
  // Verify: pixel at (x, y) should have gray level y*16
  let ok = true;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const co = (y * W + x) * 4;
      const expected = y * 16;
      if (rgba[co] !== expected || rgba[co + 1] !== expected || rgba[co + 2] !== expected) {
        ok = false;
        console.error('    interlace mismatch at (' + x + ',' + y + '): expected gray=' + expected +
          ', got R=' + rgba[co] + ' G=' + rgba[co + 1] + ' B=' + rgba[co + 2]);
        break;
      }
    }
    if (!ok) break;
  }
  assert(ok, 'interlaced pixels mapped to correct rows');
}

// ---- Test 5a: disposal 1 (do not dispose / leave in place) ----
console.log('[5a] disposal 1（帧叠加）');
{
  // 4x4 canvas, GCT with 4 colors
  // Frame 1: full red, disposal=1
  // Frame 2: partial bottom-right 2x2 green, disposal=1
  // Expected frame 2: red everywhere + green bottom-right (frame 1 left in place)
  const W = 4, H = 4;
  const f1 = new Array(W * H).fill(1); // red full frame
  const f2 = [2, 2, 2, 2]; // 2x2 green (partial frame at bottom-right)

  const gif = new GifBuilder(W, H, PAL4)
    .addFrame({ width: W, height: H, indices: f1, minCodeSize: 2, disposal: 1 })
    .addFrame({ left: 2, top: 2, width: 2, height: 2, indices: f2, minCodeSize: 2, disposal: 1 })
    .build();
  const r = decodeGif(gif);
  assertEq(r.frameCount, 2, '2 frames');
  const f2rgba = r.frames[1].rgba;
  // top-left should still be red (disposal 1 leaves frame 1)
  assertEq(f2rgba[0], 255, 'disposal1: top-left R=255 (red persists)');
  assertEq(f2rgba[1], 0, 'disposal1: top-left G=0');
  assertEq(f2rgba[3], 255, 'disposal1: top-left A=255');
  // bottom-right should be green
  const brOffset = ((3 * W + 3) * 4);
  assertEq(f2rgba[brOffset], 0, 'disposal1: bottom-right R=0 (green)');
  assertEq(f2rgba[brOffset + 1], 255, 'disposal1: bottom-right G=255');
  assertEq(f2rgba[brOffset + 3], 255, 'disposal1: bottom-right A=255');
}

// ---- Test 5b: disposal 2 (restore to background / clear) ----
console.log('[5b] disposal 2（恢复背景）');
{
  const W = 4, H = 4;
  // Frame 1: full red, disposal=2
  const f1 = new Array(W * H).fill(1); // red
  // Frame 2: partial bottom-right 2x2 green, disposal=2
  // After frame 1 (disposal 2), the canvas is cleared. Frame 2 only draws green.
  const f2 = [2, 2, 2, 2]; // 2x2 green at bottom-right

  const gif = new GifBuilder(W, H, PAL4)
    .addFrame({ width: W, height: H, indices: f1, minCodeSize: 2, disposal: 2 })
    .addFrame({ left: 2, top: 2, width: 2, height: 2, indices: f2, minCodeSize: 2, disposal: 2 })
    .build();
  const r = decodeGif(gif);
  // Frame 1 should be all red
  const f1rgba = r.frames[0].rgba;
  assertEq(f1rgba[0], 255, 'disposal2: frame1 top-left red');
  assertEq(f1rgba[3], 255, 'disposal2: frame1 top-left opaque');
  // Frame 2: frame 1 was cleared (disposal 2), frame 2 only draws bottom-right green
  const f2rgba = r.frames[1].rgba;
  assertEq(f2rgba[0], 0, 'disposal2: frame2 top-left R=0 (cleared)');
  assertEq(f2rgba[3], 0, 'disposal2: frame2 top-left alpha=0 (cleared to transparent)');
  const brOffset = ((3 * W + 3) * 4);
  assertEq(f2rgba[brOffset + 1], 255, 'disposal2: frame2 bottom-right green');
  assertEq(f2rgba[brOffset + 3], 255, 'disposal2: frame2 bottom-right opaque');
}

// ---- Test 5c: partial frame with disposal 2 ----
console.log('[5c] disposal 2 局部帧清除');
{
  const W = 4, H = 4;
  // Frame 1: full red
  const f1 = new Array(W * H).fill(1);
  // Frame 2: only top-left 2x2 blue, disposal=2 (only this area gets cleared after)
  const f2indices = [3, 3, 3, 3]; // 2x2 blue
  // Frame 3: full green
  const f3 = new Array(W * H).fill(2);

  const gif = new GifBuilder(W, H, PAL4)
    .addFrame({ width: W, height: H, indices: f1, minCodeSize: 2, disposal: 1 })
    .addFrame({ left: 0, top: 0, width: 2, height: 2, indices: f2indices, minCodeSize: 2, disposal: 2 })
    .addFrame({ width: W, height: H, indices: f3, minCodeSize: 2, disposal: 1 })
    .build();
  const r = decodeGif(gif);
  // Frame 3: after frame 2 (disposal 2 cleared top-left 2x2), frame 3 draws full green.
  // Since frame 3 covers the full canvas, everything should be green.
  const f3rgba = r.frames[2].rgba;
  assertEq(f3rgba[0], 0, 'disposal2-partial: frame3 top-left R=0 (green)');
  assertEq(f3rgba[1], 255, 'disposal2-partial: frame3 top-left G=255');
  assertEq(f3rgba[3], 255, 'disposal2-partial: frame3 top-left opaque');
}

// ---- Test 6: delay conversion ----
console.log('[6] 帧延迟换算');
{
  const gif = new GifBuilder(2, 2, PAL4)
    .addFrame({ width: 2, height: 2, indices: [0, 0, 0, 0], minCodeSize: 2, delayCs: 0 })
    .addFrame({ width: 2, height: 2, indices: [1, 1, 1, 1], minCodeSize: 2, delayCs: 100 })
    .addFrame({ width: 2, height: 2, indices: [2, 2, 2, 2], minCodeSize: 2, delayCs: 25 })
    .build();
  const r = decodeGif(gif);
  assertEq(r.frames[0].delayMs, 0, 'delay 0cs -> 0ms');
  assertEq(r.frames[1].delayMs, 1000, 'delay 100cs -> 1000ms');
  assertEq(r.frames[2].delayMs, 250, 'delay 25cs -> 250ms');
}

// ---- Test 7: loop count ----
console.log('[7] NETSCAPE 循环计数');
{
  const gifInf = new GifBuilder(2, 2, PAL4).setLoop(0)
    .addFrame({ width: 2, height: 2, indices: [0, 0, 0, 0], minCodeSize: 2 }).build();
  const rInf = decodeGif(gifInf);
  assertEq(rInf.loopCount, 0, 'loop=0 means infinite');

  const gif3 = new GifBuilder(2, 2, PAL4).setLoop(3)
    .addFrame({ width: 2, height: 2, indices: [0, 0, 0, 0], minCodeSize: 2 }).build();
  const r3 = decodeGif(gif3);
  assertEq(r3.loopCount, 3, 'loop=3');

  const gifNone = new GifBuilder(2, 2, PAL4)
    .addFrame({ width: 2, height: 2, indices: [0, 0, 0, 0], minCodeSize: 2 }).build();
  const rNone = decodeGif(gifNone);
  assertEq(rNone.loopCount, 1, 'no NETSCAPE -> loop=1 (play once)');
}

// ---- Test 8: invalid input ----
console.log('[8] 非法输入 throw');
{
  assertThrows(() => decodeGif(null), '无效输入', 'null input');
  assertThrows(() => decodeGif(undefined), '无效输入', 'undefined input');
  assertThrows(() => decodeGif(new ArrayBuffer(5)), '无效输入', 'too short');
  assertThrows(() => decodeGif(new ArrayBuffer(100)), 'GIF', 'bad header');

  // JPEG header (FFD8FF) should be rejected
  const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, ...Array(50).fill(0)]).buffer;
  assertThrows(() => decodeGif(jpg), 'GIF', 'JPEG header rejected');

  // Valid header but truncated
  const truncated = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 10, 0]).buffer;
  assertThrows(() => decodeGif(truncated), '', 'truncated after LSD throws');

  // GIF with no image frames (just header + trailer)
  // packed = 0x81: GCT flag=1, size field=1 -> 2^(1+1)=4 colors
  const noFrames = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    2, 0, 2, 0, 0x81, 0, 0, // 2x2, GCT 4 colors
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, // GCT (4 colors * 3)
    0x3B // trailer
  ]).buffer;
  assertThrows(() => decodeGif(noFrames), '不包含任何图像帧', 'no frames throws');
}

// ---- Test 9: round-trip single frame ----
console.log('[9] decode → buildGIF → decode round-trip（单帧）');
{
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    rgba[i * 4] = (x * 16) % 256;
    rgba[i * 4 + 1] = (y * 16) % 256;
    rgba[i * 4 + 2] = ((x + y) * 8) % 256;
    rgba[i * 4 + 3] = 255;
  }
  const gif1 = buildGIF([{ width: W, height: H, rgba, delayCs: 10 }], {
    width: W, height: H, loop: 0, dither: false
  });
  const r1 = decodeGif(gif1.buffer);
  assertEq(r1.width, W, 'rt width');
  assertEq(r1.height, H, 'rt height');
  assertEq(r1.frameCount, 1, 'rt frameCount');

  // Re-encode
  const frames2 = r1.frames.map(f => ({
    width: W, height: H, rgba: f.rgba, delayCs: Math.max(2, Math.round(f.delayMs / 10))
  }));
  const gif2 = buildGIF(frames2, { width: W, height: H, loop: 0, dither: false });
  const r2 = decodeGif(gif2.buffer);
  assertEq(r2.frameCount, 1, 'rt2 frameCount');

  // Verify colors are close (encoder uses 6x6x6 palette, so exact match not guaranteed,
  // but should be within 51/2 = ~26 per channel due to quantization)
  let maxDiff = 0;
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(rgba[i * 4 + c] - r2.frames[0].rgba[i * 4 + c]);
      if (d > maxDiff) maxDiff = d;
    }
  }
  assert(maxDiff <= 30, 'round-trip color max diff <= 30 (got ' + maxDiff + ')');
}

// ---- Test 10: multi-frame round-trip with code-size crossing ----
console.log('[10] 多帧 round-trip（跨码宽 9→10→11→12）');
{
  const W = 48, H = 48;
  const numFrames = 5;
  const srcFrames = [];
  for (let f = 0; f < numFrames; f++) {
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = (i / W) | 0;
      // High-entropy pattern to force dictionary growth across code sizes
      rgba[i * 4] = (x * 7 + y * 13 + f * 31) % 256;
      rgba[i * 4 + 1] = (x * 11 + y * 3 + f * 17) % 256;
      rgba[i * 4 + 2] = (x * 5 + y * 19 + f * 23) % 256;
      rgba[i * 4 + 3] = 255;
    }
    srcFrames.push({ width: W, height: H, rgba, delayCs: 5 + f * 2 });
  }
  const gif1 = buildGIF(srcFrames, { width: W, height: H, loop: 0, dither: false });
  const r1 = decodeGif(gif1.buffer);
  assertEq(r1.frameCount, numFrames, 'multi-frame count');
  for (let f = 0; f < numFrames; f++) {
    assertEq(r1.frames[f].index, f, 'frame index ' + f);
    assertEq(r1.frames[f].delayMs, (5 + f * 2) * 10, 'frame ' + f + ' delayMs');
  }

  // Re-encode decoded frames
  const frames2 = r1.frames.map(fr => ({
    width: W, height: H, rgba: fr.rgba,
    delayCs: Math.max(2, Math.round(fr.delayMs / 10))
  }));
  const gif2 = buildGIF(frames2, { width: W, height: H, loop: 0, dither: false });
  const r2 = decodeGif(gif2.buffer);
  assertEq(r2.frameCount, numFrames, 'multi-frame rt2 count');

  // Verify each frame is fully opaque (no transparency from encoder)
  let allOpaque = true;
  for (let f = 0; f < numFrames; f++) {
    const rgba = r2.frames[f].rgba;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] !== 255) { allOpaque = false; break; }
    }
  }
  assert(allOpaque, 'all re-encoded frames fully opaque');
}

// ---- Test 11: GIF87a header ----
console.log('[11] GIF87a 头支持');
{
  const bytes = [];
  const u16 = (v) => { bytes.push(v & 0xff, (v >> 8) & 0xff); };
  // GIF87a
  bytes.push(0x47, 0x49, 0x46, 0x38, 0x37, 0x61);
  u16(2); u16(2);
  bytes.push(0x81, 0, 0); // GCT 4 colors (size field=1 -> 2^(1+1)=4)
  for (let i = 0; i < 4; i++) bytes.push(i * 80, i * 80, i * 80);
  // image
  bytes.push(0x2C);
  u16(0); u16(0); u16(2); u16(2);
  bytes.push(0x00); // no LCT, no interlace
  const lzw = lzwEncodeTest([0, 1, 2, 3], 2);
  bytes.push(2);            // LZW min code size
  bytes.push(lzw.length);   // sub-block length
  for (let i = 0; i < lzw.length; i++) bytes.push(lzw[i]);
  bytes.push(0x00);         // block terminator
  bytes.push(0x3B);         // trailer
  const r = decodeGif(new Uint8Array(bytes).buffer);
  assertEq(r.frameCount, 1, 'GIF87a decoded 1 frame');
  assertEq(r.frames[0].rgba[0], 0, 'GIF87a pixel 0 black');
  assertEq(r.frames[0].rgba[4], 80, 'GIF87a pixel 1 gray=80');
}

// ---- Test 12: multi-frame with transparency + disposal 1 ----
console.log('[12] 多帧透明叠加（disposal 1）');
{
  const W = 4, H = 4;
  // Frame 1: red background (opaque), disposal 1
  const f1 = new Array(W * H).fill(1); // red
  // Frame 2: only center 2x2 is transparent, rest not drawn (partial frame)
  // We need a partial frame with transparent pixels
  const f2Indices = [0, 0, 0, 0]; // 2x2, index 0 (black in GCT, but we'll mark 0 transparent)
  const gif = new GifBuilder(W, H, PAL4)
    .addFrame({ width: W, height: H, indices: f1, minCodeSize: 2, disposal: 1, delayCs: 10 })
    .addFrame({
      left: 1, top: 1, width: 2, height: 2,
      indices: f2Indices, minCodeSize: 2, disposal: 1, delayCs: 10,
      transparentFlag: true, transIndex: 0
    })
    .build();
  const r = decodeGif(gif);
  assertEq(r.frameCount, 2, 'transparent overlay 2 frames');
  const f2rgba = r.frames[1].rgba;
  // Center pixels (1,1) and (2,2) should be transparent (alpha=0), showing... wait,
  // disposal 1 means frame 1 (red) stays. Frame 2 has transparent pixels at center.
  // Transparent pixels don't overwrite the canvas, so center should still be red.
  const centerOffset = ((1 * W + 1) * 4);
  assertEq(f2rgba[centerOffset], 255, 'transparent overlay: center stays red R');
  assertEq(f2rgba[centerOffset + 3], 255, 'transparent overlay: center stays red A');
}

// ---- Test 13: frame index ordering ----
console.log('[13] 帧序号连续性');
{
  const gif = new GifBuilder(2, 2, PAL4)
    .addFrame({ width: 2, height: 2, indices: [0, 0, 0, 0], minCodeSize: 2 })
    .addFrame({ width: 2, height: 2, indices: [1, 1, 1, 1], minCodeSize: 2 })
    .addFrame({ width: 2, height: 2, indices: [2, 2, 2, 2], minCodeSize: 2 })
    .addFrame({ width: 2, height: 2, indices: [3, 3, 3, 3], minCodeSize: 2 })
    .build();
  const r = decodeGif(gif);
  for (let i = 0; i < 4; i++) {
    assertEq(r.frames[i].index, i, 'frame index ' + i);
  }
}

// ===================================================================
// 结果汇总
// ===================================================================

console.log('\n=== Results ===');
console.log('PASS: ' + passCount);
console.log('FAIL: ' + failCount);
if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
  process.exit(1);
} else {
  console.log('\n✓ All tests passed.');
}
