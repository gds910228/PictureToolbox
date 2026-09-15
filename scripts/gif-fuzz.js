// scripts/gif-fuzz.js
// 种子化随机 GIF 模糊测试（零 npm 依赖，node 直接运行）。
//
// 运行：node scripts/gif-fuzz.js [iterations] [seed]
//   iterations: 每类测试迭代次数，默认 500
//   seed: 随机种子，默认 20260906（打印在输出中以便复现）
//
// 三类属性测试：
//   a) 合法样本：decode 不抛错、帧数一致、合成帧尺寸正确
//   b) round-trip：decode→buildGIFDiff→decode 帧数/延时一致、像素 ≥99% 每通道差 ≤8
//   c) 畸变样本：decode 要么正确解析要么 throw，不得死循环/崩溃，单样本 <1s
//
// 发现 bug 时打印复现种子和详细信息。

'use strict';

const path = require('path');
const { decodeGif } = require(path.join(__dirname, '..', 'utils', 'gif-decoder.js'));
const { buildGIFDiff, buildGIF, PALETTE } = require(path.join(__dirname, '..', 'utils', 'gif-encoder.js'));

// ---- 种子化 PRNG（mulberry32）----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- LZW 编码器（用于生成测试 GIF，支持任意 minCodeSize）----
function lzwEncodeFuzz(indices, minCodeSize) {
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
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
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

// 隔行扫描行序
const INTERLACE_PASSES = [[0, 8], [4, 8], [2, 4], [1, 2]];

// ---- 随机 GIF 生成器 ----
class RandomGifGenerator {
  constructor(seed) {
    this.rng = mulberry32(seed);
    this.seed = seed;
  }

  randInt(min, max) {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  pick(arr) {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  // 生成随机调色板（颜色取自编码器 PALETTE 以保证 round-trip 无损）
  randomPalette(size, useEncoderColors) {
    const pal = [];
    for (let i = 0; i < size; i++) {
      if (useEncoderColors) {
        // 全部使用编码器 PALETTE 中的颜色（循环取，256 色调色板也无损）
        pal.push(PALETTE[i % 216]);
      } else {
        pal.push([this.randInt(0, 255), this.randInt(0, 255), this.randInt(0, 255)]);
      }
    }
    return pal;
  }

  generate(opts) {
    opts = opts || {};
    const useEncoderColors = opts.useEncoderColors !== false;
    const maxDim = opts.maxDim || 64;
    const maxFrames = opts.maxFrames || 15;

    const width = this.randInt(4, maxDim);
    const height = this.randInt(4, maxDim);
    const frameCount = this.randInt(1, maxFrames);

    // GCT
    const gctSizes = [2, 4, 8, 16, 32, 64, 128, 256];
    const gctSize = this.pick(gctSizes);
    const gct = this.randomPalette(gctSize, useEncoderColors);
    const minCodeSize = Math.max(2, Math.round(Math.log2(gctSize)));

    // 随机参数
    const loopCount = this.pick([0, 0, 0, 1, 3, 5]); // 偏向无限循环
    const hasComment = this.rng() < 0.3;
    const hasUnknownExt = this.rng() < 0.2;

    // 生成帧
    const frames = [];
    // 模拟画布：-1 = 未绘制（透明），>=0 = 已绘制的调色板索引
    const canvas = new Int16Array(width * height);
    canvas.fill(-1);

    for (let fi = 0; fi < frameCount; fi++) {
      const disposal = this.pick([0, 1, 1, 1, 2, 3]); // 偏向 0/1
      const interlace = this.rng() < 0.3;
      const delayCs = this.randInt(2, 100);

      // 先决定调色板（GCT 或 LCT），再据此确定 transIndex
      const useLct = this.rng() < 0.3;
      let palette = gct;
      let frameMinCodeSize = minCodeSize;
      if (useLct) {
        const lctSize = this.pick(gctSizes);
        palette = this.randomPalette(lctSize, useEncoderColors);
        frameMinCodeSize = Math.max(2, Math.round(Math.log2(lctSize)));
      }
      const paletteSize = palette.length;
      const transparentFlag = this.rng() < 0.4;
      const transIndex = transparentFlag ? this.randInt(0, paletteSize - 1) : 0;

      // 随机决定帧区域（全帧或部分）
      const isFullFrame = this.rng() < 0.6;
      let fx, fy, fw, fh;
      if (isFullFrame) {
        fx = 0; fy = 0; fw = width; fh = height;
      } else {
        fw = this.randInt(2, width);
        fh = this.randInt(2, height);
        fx = this.randInt(0, width - fw);
        fy = this.randInt(0, height - fh);
      }

      // 生成像素索引（全部在 [0, paletteSize-1] 范围内，或为 transIndex）
      const rawIndices = new Uint8Array(fw * fh);
      const changeDensity = this.rng() * 0.8 + 0.1; // 10%-90% 像素变化
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const cx = fx + x, cy = fy + y;
          const canvasIdx = cy * width + cx;
          const shouldChange = this.rng() < changeDensity || canvas[canvasIdx] === -1;
          if (shouldChange) {
            let idx;
            if (transparentFlag && this.rng() < 0.2) {
              idx = transIndex;
            } else {
              idx = this.randInt(0, paletteSize - 1);
            }
            rawIndices[y * fw + x] = idx;
            if (!(transparentFlag && idx === transIndex)) {
              canvas[canvasIdx] = idx;
            }
          } else {
            // 不变：复用画布上的已有像素；若画布未绘制则用透明索引或随机
            if (canvas[canvasIdx] >= 0 && canvas[canvasIdx] < paletteSize) {
              rawIndices[y * fw + x] = canvas[canvasIdx];
            } else if (transparentFlag) {
              rawIndices[y * fw + x] = transIndex;
            } else {
              rawIndices[y * fw + x] = this.randInt(0, paletteSize - 1);
            }
          }
        }
      }

      // 隔行扫描重排
      let storedIndices = rawIndices;
      if (interlace && fw > 1 && fh > 1) {
        storedIndices = new Uint8Array(fw * fh);
        let r = 0;
        for (const [start, step] of INTERLACE_PASSES) {
          for (let y = start; y < fh; y += step) {
            for (let x = 0; x < fw; x++) {
              storedIndices[r * fw + x] = rawIndices[y * fw + x];
            }
            r++;
          }
        }
      }

      // disposal 2：帧后清除画布区域
      if (disposal === 2) {
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            canvas[(fy + y) * width + (fx + x)] = -1;
          }
        }
      }

      frames.push({
        left: fx, top: fy, width: fw, height: fh,
        indices: storedIndices,
        palette: useLct ? palette : null,
        minCodeSize: frameMinCodeSize,
        disposal, transparentFlag, transIndex, interlace, delayCs
      });
    }

    const buffer = this.serialize(width, height, gct, gctSize, loopCount, frames, hasComment, hasUnknownExt);
    return {
      buffer,
      params: {
        width, height, frameCount, gctSize, loopCount,
        seed: this.seed
      }
    };
  }

  serialize(width, height, gct, gctSize, loopCount, frames, hasComment, hasUnknownExt) {
    const bytes = [];
    const u16 = (v) => { bytes.push(v & 0xff, (v >> 8) & 0xff); };
    const raw = (arr) => { for (const b of arr) bytes.push(b); };

    // Header
    raw([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    // LSD
    u16(width); u16(height);
    const gctBits = Math.round(Math.log2(gctSize)) - 1;
    bytes.push(0x80 | (gctBits & 0x07), 0, 0);
    // GCT
    for (const c of gct) bytes.push(c[0], c[1], c[2]);

    // NETSCAPE
    if (loopCount !== null) {
      raw([0x21, 0xFF, 0x0B]);
      raw([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]);
      bytes.push(0x03, 0x01);
      u16(loopCount);
      bytes.push(0x00);
    }

    // Comment extension
    if (hasComment) {
      bytes.push(0x21, 0xFE);
      const comment = 'Fuzz test comment ' + this.randInt(0, 9999);
      const cb = Buffer.from(comment, 'utf8');
      let pos = 0;
      while (pos < cb.length) {
        const len = Math.min(255, cb.length - pos);
        bytes.push(len);
        for (let i = 0; i < len; i++) bytes.push(cb[pos + i]);
        pos += len;
      }
      bytes.push(0x00);
    }

    // Unknown extension (0x0F = plain text, but we use a fake label)
    if (hasUnknownExt) {
      bytes.push(0x21, 0x0F);
      const blockLen = this.randInt(1, 20);
      bytes.push(blockLen);
      for (let i = 0; i < blockLen; i++) bytes.push(this.randInt(0, 255));
      // sub-blocks
      const numSub = this.randInt(0, 3);
      for (let s = 0; s < numSub; s++) {
        const sl = this.randInt(1, 50);
        bytes.push(sl);
        for (let i = 0; i < sl; i++) bytes.push(this.randInt(0, 255));
      }
      bytes.push(0x00);
    }

    for (const frame of frames) {
      // GCE
      raw([0x21, 0xF9, 0x04]);
      let packed = (frame.disposal & 0x07) << 2;
      if (frame.transparentFlag) packed |= 0x01;
      bytes.push(packed);
      u16(frame.delayCs);
      bytes.push(frame.transparentFlag ? frame.transIndex : 0);
      bytes.push(0x00);

      // Image Descriptor
      bytes.push(0x2C);
      u16(frame.left); u16(frame.top);
      u16(frame.width); u16(frame.height);
      let imgPacked = 0;
      if (frame.interlace) imgPacked |= 0x40;
      if (frame.palette) {
        const lctBits = Math.round(Math.log2(frame.palette.length)) - 1;
        imgPacked |= 0x80 | (lctBits & 0x07);
      }
      bytes.push(imgPacked);

      if (frame.palette) {
        for (const c of frame.palette) bytes.push(c[0], c[1], c[2]);
      }

      // LZW data
      const lzw = lzwEncodeFuzz(Array.from(frame.indices), frame.minCodeSize);
      bytes.push(frame.minCodeSize);
      let pos = 0;
      while (pos < lzw.length) {
        const len = Math.min(255, lzw.length - pos);
        bytes.push(len);
        for (let i = 0; i < len; i++) bytes.push(lzw[pos + i]);
        pos += len;
      }
      bytes.push(0x00);
    }

    bytes.push(0x3B);
    return new Uint8Array(bytes).buffer;
  }
}

// ---- 畸变器：对合法 GIF 随机破坏 ----
function corruptBuffer(buffer, rng) {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  const corruptionType = Math.floor(rng() * 4);

  if (corruptionType === 0 && len > 20) {
    // 随机截断
    const cutAt = 10 + Math.floor(rng() * (len - 10));
    return bytes.slice(0, cutAt).buffer;
  } else if (corruptionType === 1) {
    // 随机位翻转（1-5 位）
    const numFlips = 1 + Math.floor(rng() * 5);
    for (let i = 0; i < numFlips; i++) {
      const pos = Math.floor(rng() * len);
      const bit = Math.floor(rng() * 8);
      bytes[pos] ^= (1 << bit);
    }
    return bytes.buffer;
  } else if (corruptionType === 2 && len > 30) {
    // 破坏子块长度（把某个位置的值改成 255 或 0）
    const pos = 20 + Math.floor(rng() * (len - 20));
    bytes[pos] = rng() < 0.5 ? 255 : 0;
    return bytes.buffer;
  } else {
    // 随机字节替换（1-10 个）
    const numReplace = 1 + Math.floor(rng() * 10);
    for (let i = 0; i < numReplace; i++) {
      const pos = Math.floor(rng() * len);
      bytes[pos] = Math.floor(rng() * 256);
    }
    return bytes.buffer;
  }
}

// ---- 带超时的 decode（检测死循环）----
function decodeWithTimeout(buffer, timeoutMs) {
  // 由于 decodeGif 是同步的，使用子进程无法在单文件中实现。
  // 改为在解码器中已有安全限制（LZW 迭代上限、块计数上限），
  // 这里用 try/catch 包裹，并测量耗时。
  const start = Date.now();
  try {
    const result = decodeGif(buffer);
    const elapsed = Date.now() - start;
    return { success: true, result, elapsed, error: null };
  } catch (e) {
    const elapsed = Date.now() - start;
    return { success: false, result: null, elapsed, error: e.message };
  }
}

// ---- 测试运行器 ----
function runTest(name, iterations, seed, testFn) {
  console.log('\n=== ' + name + ' (' + iterations + ' iterations, seed=' + seed + ') ===');
  const rng = mulberry32(seed);
  let pass = 0, fail = 0;
  const failures = [];
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    const iterSeed = (seed + i * 7919) >>> 0;
    try {
      const result = testFn(iterSeed, i);
      if (result === true || result === undefined) {
        pass++;
      } else {
        fail++;
        failures.push({ iteration: i, seed: iterSeed, reason: result });
      }
    } catch (e) {
      fail++;
      failures.push({ iteration: i, seed: iterSeed, reason: 'EXCEPTION: ' + e.message });
    }
    if ((i + 1) % 100 === 0) {
      process.stdout.write('\r  ' + (i + 1) + '/' + iterations + ' (pass=' + pass + ' fail=' + fail + ')');
    }
  }
  const elapsed = Date.now() - start;
  process.stdout.write('\r');
  console.log('  PASS: ' + pass + ' / FAIL: ' + fail + ' (' + elapsed + 'ms, ' + (elapsed / iterations).toFixed(1) + 'ms/iter)');

  if (failures.length > 0) {
    console.log('  Failures (showing up to 10):');
    failures.slice(0, 10).forEach(f => {
      console.log('    iter=' + f.iteration + ' seed=' + f.seed + ' reason=' + f.reason);
    });
  }
  return { pass, fail, failures };
}

// ---- 属性 a：合法样本 ----
function testValid(seed) {
  const gen = new RandomGifGenerator(seed);
  const { buffer, params } = gen.generate({ useEncoderColors: true, maxDim: 48, maxFrames: 10 });
  const r = decodeWithTimeout(buffer, 5000);
  if (!r.success) return 'decode threw: ' + r.error;
  if (r.result.frameCount !== params.frameCount)
    return 'frameCount mismatch: expected ' + params.frameCount + ' got ' + r.result.frameCount;
  if (r.result.width !== params.width || r.result.height !== params.height)
    return 'dimension mismatch: expected ' + params.width + 'x' + params.height + ' got ' + r.result.width + 'x' + r.result.height;
  for (let i = 0; i < r.result.frames.length; i++) {
    const fr = r.result.frames[i];
    if (fr.rgba.length !== params.width * params.height * 4)
      return 'frame ' + i + ' rgba length wrong: ' + fr.rgba.length;
    if (fr.index !== i)
      return 'frame ' + i + ' index wrong: ' + fr.index;
  }
  if (r.elapsed > 1000) return 'decode took ' + r.elapsed + 'ms (>1000ms)';
  return true;
}

// ---- 属性 b：round-trip ----
function testRoundTrip(seed) {
  const gen = new RandomGifGenerator(seed);
  const { buffer, params } = gen.generate({ useEncoderColors: true, maxDim: 48, maxFrames: 10 });

  // 第一次 decode
  const r1 = decodeWithTimeout(buffer, 5000);
  if (!r1.success) return 'first decode threw: ' + r1.error;

  // 用 buildGIFDiff 重新编码
  const W = r1.result.width, H = r1.result.height;
  const encFrames = r1.result.frames.map(fr => ({
    width: W, height: H,
    rgba: fr.rgba,
    delayCs: Math.max(2, Math.round(fr.delayMs / 10))
  }));

  let encoded;
  try {
    encoded = buildGIFDiff(encFrames, { width: W, height: H, loop: 0, dither: false });
  } catch (e) {
    return 'buildGIFDiff threw: ' + e.message;
  }

  // 第二次 decode
  const r2 = decodeWithTimeout(encoded.buffer, 5000);
  if (!r2.success) return 'second decode threw: ' + r2.error;
  if (r2.result.frameCount !== r1.result.frameCount)
    return 'frameCount after round-trip: expected ' + r1.result.frameCount + ' got ' + r2.result.frameCount;

  // 像素比较：≥99% 每通道差 ≤8
  let totalCh = 0, badCh = 0, maxDiff = 0;
  for (let f = 0; f < r1.result.frames.length; f++) {
    const a = r1.result.frames[f].rgba;
    const b = r2.result.frames[f].rgba;
    for (let i = 0; i < a.length; i += 4) {
      // 只比较不透明像素（alpha 通道单独检查）
      if (a[i + 3] === 255 && b[i + 3] === 255) {
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(a[i + c] - b[i + c]);
          if (d > maxDiff) maxDiff = d;
          if (d > 8) badCh++;
          totalCh++;
        }
      }
      // alpha 应该一致
      if (a[i + 3] !== b[i + 3]) badCh++;
      if (a[i + 3] === 255) totalCh++;
    }
  }
  const badPct = totalCh > 0 ? (badCh / totalCh * 100) : 0;
  if (badPct > 1)
    return 'round-trip pixel mismatch: ' + badCh + '/' + totalCh + ' (' + badPct.toFixed(2) + '%) > 1%, maxDiff=' + maxDiff;
  return true;
}

// ---- 属性 c：畸变样本 ----
function testCorrupted(seed) {
  const gen = new RandomGifGenerator(seed);
  const { buffer } = gen.generate({ useEncoderColors: false, maxDim: 32, maxFrames: 5 });
  const rng = mulberry32(seed ^ 0xDEADBEEF);
  const corrupted = corruptBuffer(buffer, rng);
  const r = decodeWithTimeout(corrupted, 1000);
  // 不要求成功，但不能死循环（>1s）或崩溃
  if (r.elapsed > 1000) return 'decode of corrupted data took ' + r.elapsed + 'ms (possible infinite loop)';
  // 如果成功，帧数应 >= 1
  if (r.success && r.result.frameCount < 1) return 'decoded with 0 frames';
  return true;
}

// ---- 主函数 ----
function main() {
  const iterations = parseInt(process.argv[2]) || 500;
  const seed = parseInt(process.argv[3]) || 20260906;

  console.log('GIF Fuzz Test');
  console.log('Iterations per suite: ' + iterations);
  console.log('Base seed: ' + seed);
  console.log('Node version: ' + process.version);
  console.log('Platform: ' + process.platform + ' ' + process.arch);

  const results = {};
  results.a = runTest('(a) Valid samples', iterations, seed, testValid);
  results.b = runTest('(b) Round-trip', iterations, seed + 100000, testRoundTrip);
  results.c = runTest('(c) Corrupted samples', iterations, seed + 200000, testCorrupted);

  console.log('\n=== Summary ===');
  let allPass = true;
  for (const [k, v] of Object.entries(results)) {
    const status = v.fail === 0 ? 'PASS' : 'FAIL';
    if (v.fail > 0) allPass = false;
    console.log('  ' + k + ': ' + status + ' (' + v.pass + ' pass, ' + v.fail + ' fail)');
  }
  console.log(allPass ? '\n✓ All fuzz tests passed.' : '\n✗ Some fuzz tests FAILED.');
  process.exit(allPass ? 0 : 1);
}

// 导出供调试使用
module.exports = {
  RandomGifGenerator,
  testValid,
  testRoundTrip,
  testCorrupted,
  corruptBuffer,
  mulberry32
};

// 仅在直接运行时执行 main
if (require.main === module) {
  main();
}
