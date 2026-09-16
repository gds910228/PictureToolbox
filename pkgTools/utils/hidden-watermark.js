// utils/hidden-watermark.js
// 隐形水印：空域 LSB 信息隐藏算法（纯本地、零外部 API）。
//
// 把文字按 UTF-8 编码为比特流，加同步头 + 长度 + CRC16 校验尾，
// 用「以密钥为种子的确定性 PRNG」生成伪随机位置序列，分散写入像素蓝通道最低位，
// 重复 3 次冗余；提取时按相同序列读出、逐 bit 多数判决、SYNC/CRC 校验。
//
// 二进制纪律（吸取项目此前 gif-encoder.js 自写 LZW 的教训：码宽递增边界、魔数字节长度）：
//  - bit 顺序全文统一 MSB-first（字节内高位在前），注释处显式声明。
//  - SYNC 魔数恰好 3 字节 0x77 0xAA 0x55，不多写不少写。
//  - PRNG 必须可种子化（xfnv1a + mulberry32）。**严禁 Math.random()**——
//    嵌入与提取的位置序列必须逐位一致，否则不报错、只读出乱码（最隐蔽的坑）。
//  - 位置生成器 k-无关：第 i 个位置与总共取多少个位置无关，故提取端可增量读取
//    （先读 SYNC 定位、再读 LEN 求长度、再读 payload），无需预知帧长。
//
// 能力边界（诚实声明）：
//  - ✅ PNG 无损往返：逐字还原；存相册（PNG）再选回仍可提取。
//  - ⚠️ 抗 JPEG：蓝通道 LSB 受 JPEG 4:2:0 色度子采样影响，q80 重压大概率失败。
//    真机实测为准；失败则诚实标注，DCT 量化域方案作为后续迭代。
//  - ❌ 抗缩放/截图/社交二次转发：不在保证范围。
//
// 全部为纯函数、无 wx 依赖，可在 node 单测（见 tmp/hidden-watermark.test.js）。

'use strict';

// ---- 帧格式常量 ----
var SYNC_BYTES = [0x77, 0xAA, 0x55]; // 3 字节同步头（恰好 24 bit）
var SYNC_LEN = SYNC_BYTES.length;     // 3
var LEN_FIELD_BYTES = 2;              // 16 bit 大端 payload 长度
var CRC_FIELD_BYTES = 2;              // 16 bit 大端 CRC
var HEADER_BITS = (SYNC_LEN + LEN_FIELD_BYTES) * 8; // 40 bit（SYNC+LEN）
var REDUNDANCY = 3;                   // 冗余份数

// ---- CRC-16/CCITT-FALSE（poly 0x1021, init 0xFFFF, no reflect, no xorout）----
// 已知向量：crc16("123456789") == 0x29B1（测试脚本对照此向量）
function crc16(bytes) {
  var crc = 0xFFFF;
  for (var i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] << 8);
    for (var j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      else crc = (crc << 1) & 0xFFFF;
    }
  }
  return crc & 0xFFFF;
}

// ---- UTF-8 编解码（手写，不依赖 TextEncoder，兼容 node 与小程序）----
function utf8Encode(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    // 高代理项 → 拼接低代理项得到 astral plane 码点（emoji 走这里）
    if (code >= 0xD800 && code <= 0xDBFF) {
      var lo = str.charCodeAt(++i);
      code = 0x10000 + ((code - 0xD800) << 10) + (lo - 0xDC00);
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    } else if (code < 0x10000) {
      out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    } else {
      out.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F),
        0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    }
  }
  return Uint8Array.from(out);
}

// 解码：遇非法序列以 U+FFFD 替换，不抛异常（提取端数据可能受损）
function utf8Decode(bytes) {
  var s = '';
  var i = 0;
  while (i < bytes.length) {
    var b = bytes[i];
    var code, len;
    if (b < 0x80) { code = b; len = 1; }
    else if ((b & 0xE0) === 0xC0) { code = b & 0x1F; len = 2; }
    else if ((b & 0xF0) === 0xE0) { code = b & 0x0F; len = 3; }
    else if ((b & 0xF8) === 0xF0) { code = b & 0x07; len = 4; }
    else { s += '�'; i++; continue; }

    if (i + len > bytes.length) { s += '�'; i++; continue; }
    var ok = true;
    for (var j = 1; j < len; j++) {
      var cb = bytes[i + j];
      if ((cb & 0xC0) !== 0x80) { ok = false; break; }
      code = (code << 6) | (cb & 0x3F);
    }
    if (!ok) { s += '�'; i++; continue; }

    if (code < 0x10000) {
      s += String.fromCharCode(code);
    } else {
      code -= 0x10000;
      s += String.fromCharCode(0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF));
    }
    i += len;
  }
  return s;
}

// ---- 种子化 PRNG ----

// xfnv1a：字符串 → uint32 种子（FNV-1a 变体，分布均匀、实现极简）
function hashSeed(key) {
  var h = 0x811c9dc5; // 2166136261
  for (var i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // 16777619
  }
  return h >>> 0;
}

// mulberry32：uint32 种子 → () => float[0,1)，周期 2^32，确定可复现
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 位置生成器：k-无关。
//   第 i 次调用 next() 返回第 i 个去重位置；返回序列只依赖 (seed,count) 与调用次数，
//   与「总共会取多少个」无关——这是提取端增量读取（先 SYNC 再 LEN 再 payload）的前提。
//   用 Set 记录已用位置，碰撞则重抽。容量利用率低时（实际场景：帧几百 bit、图几万~百万像素）
//   碰撞率可忽略；接近容量上限时退化，但实用远达不到。
function makePositionGen(seed, count) {
  var rng = mulberry32(seed);
  var used = new Set();
  return function next() {
    var p;
    do { p = Math.floor(rng() * count); } while (used.has(p));
    used.add(p);
    return p;
  };
}

// ---- bit 与 byte 互转（MSB-first：字节内高位 bit 在前）----
function bytesToBits(bytes) {
  var bits = new Uint8Array(bytes.length * 8);
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    for (var j = 0; j < 8; j++) {
      bits[i * 8 + j] = (b >> (7 - j)) & 1; // MSB first
    }
  }
  return bits;
}

function bitsToBytes(bits) {
  var n = (bits.length / 8) | 0;
  var out = new Uint8Array(n);
  for (var i = 0; i < n; i++) {
    var b = 0;
    for (var j = 0; j < 8; j++) b = (b << 1) | (bits[i * 8 + j] & 1); // MSB first
    out[i] = b & 0xFF;
  }
  return out;
}

// ---- 帧封装 ----
// [SYNC 3B][LEN 2B BE][PAYLOAD n B][CRC 2B BE]  CRC 覆盖 LEN+PAYLOAD
function frameMessage(text) {
  var payload = utf8Encode(text);
  var len = payload.length;
  if (len > 0xFFFF) {
    return { ok: false, error: '水印文字过长（>65535 字节）' };
  }
  var frame = new Uint8Array(SYNC_LEN + LEN_FIELD_BYTES + len + CRC_FIELD_BYTES);
  frame[0] = SYNC_BYTES[0]; frame[1] = SYNC_BYTES[1]; frame[2] = SYNC_BYTES[2];
  frame[3] = (len >> 8) & 0xFF; frame[4] = len & 0xFF; // LEN 大端
  frame.set(payload, 5);
  var crcInput = frame.subarray(SYNC_LEN, SYNC_LEN + LEN_FIELD_BYTES + len); // LEN+PAYLOAD
  var crc = crc16(crcInput);
  frame[5 + len] = (crc >> 8) & 0xFF;     // CRC 大端
  frame[6 + len] = crc & 0xFF;
  return { ok: true, bytes: frame, bitLen: frame.length * 8 };
}

// ---- 容量估算（供 UI 展示）----
// 每帧 bit 需 REDUNDANCY 个位置；帧头尾开销 7 字节=56 bit。
function maxPayloadBytes(totalPixels) {
  var usable = Math.floor(totalPixels / REDUNDANCY); // 可用 bit 数
  var overhead = (SYNC_LEN + LEN_FIELD_BYTES + CRC_FIELD_BYTES) * 8; // 56
  if (usable <= overhead) return 0;
  return Math.floor((usable - overhead) / 8);
}

// ---- 嵌入（纯函数：操作 RGBA 副本，不修改入参，不碰 wx）----
// rgba: Uint8ClampedArray (R,G,B,A 重复)；写到蓝通道 LSB (offset +2)
function embed(rgba, w, h, text, key) {
  var totalPixels = w * h;
  var fr = frameMessage(text);
  if (!fr.ok) return { ok: false, error: fr.error, capacity: maxPayloadBytes(totalPixels) };

  var bitLen = fr.bitLen;
  if (bitLen * REDUNDANCY > totalPixels) {
    return {
      ok: false,
      error: '图片太小或水印过长（容量不足）',
      bitsUsed: bitLen * REDUNDANCY,
      capacity: maxPayloadBytes(totalPixels)
    };
  }

  var bits = bytesToBits(fr.bytes);
  var out = new Uint8ClampedArray(rgba); // 拷贝，不改入参
  var gen = makePositionGen(hashSeed(key), totalPixels);

  // 每个 frame bit 写入 REDUNDANCY 个不同像素的蓝通道 LSB
  for (var b = 0; b < bitLen; b++) {
    var bit = bits[b];
    for (var r = 0; r < REDUNDANCY; r++) {
      var px = gen();
      var o = px * 4 + 2; // 蓝通道
      out[o] = (out[o] & 0xFE) | bit;
    }
  }
  return { ok: true, rgba: out, bitsUsed: bitLen * REDUNDANCY, capacity: maxPayloadBytes(totalPixels) };
}

// ---- 提取（纯函数）----
// 增量读取：SYNC(24bit) → LEN(16bit) → PAYLOAD(len*8)+CRC(16bit)
// 位置生成器按相同 (key,count) 重建，调用顺序与 embed 完全一致。
function extract(rgba, w, h, key) {
  var totalPixels = w * h;
  var gen = makePositionGen(hashSeed(key), totalPixels);

  var agreeCount = 0; // 多数判决一致票数累加（每 bit 2 或 3）
  var votesRead = 0;

  // 读取 numBits 个 frame-bit：每 bit 取 REDUNDANCY 个位置多数判决
  function readFrameBits(numBits) {
    var out = new Uint8Array(numBits);
    for (var b = 0; b < numBits; b++) {
      var s = 0;
      for (var r = 0; r < REDUNDANCY; r++) {
        var px = gen();
        s += rgba[px * 4 + 2] & 1;
      }
      var maj = s >= 2 ? 1 : 0; // 3 取 ≥2
      out[b] = maj;
      // 一致票数：s==0 或 3 → 3 票一致；s==1 或 2 → 2 票一致
      agreeCount += (s === 0 || s === 3) ? 3 : 2;
      votesRead += REDUNDANCY;
    }
    return out;
  }

  // 1. SYNC
  var syncBits = readFrameBits(SYNC_LEN * 8);
  var syncBytes = bitsToBytes(syncBits);
  var syncOk = syncBytes[0] === SYNC_BYTES[0] &&
    syncBytes[1] === SYNC_BYTES[1] &&
    syncBytes[2] === SYNC_BYTES[2];
  if (!syncOk) {
    return { ok: false, syncOk: false, crcOk: false, text: '', confidence: 0, status: 'no-watermark' };
  }

  // 2. LEN
  var lenBits = readFrameBits(LEN_FIELD_BYTES * 8);
  var lenBytes = bitsToBytes(lenBits);
  var payloadLen = (lenBytes[0] << 8) | lenBytes[1];

  // 长度合理性校验：不能超过容量，也不能为负（长度域被损坏到极大值时拦截，避免 runaway）
  var maxLen = maxPayloadBytes(totalPixels);
  if (payloadLen > maxLen) {
    return { ok: false, syncOk: true, crcOk: false, text: '', confidence: 0, status: 'corrupt' };
  }

  // 3. PAYLOAD + CRC
  var restBits = readFrameBits(payloadLen * 8 + CRC_FIELD_BYTES * 8);
  var restBytes = bitsToBytes(restBits); // payloadLen + 2 字节
  var payload = restBytes.subarray(0, payloadLen);
  var crcRecv = (restBytes[payloadLen] << 8) | restBytes[payloadLen + 1];

  // 重算 CRC：覆盖 LEN+PAYLOAD
  var crcInput = new Uint8Array(LEN_FIELD_BYTES + payloadLen);
  crcInput[0] = lenBytes[0]; crcInput[1] = lenBytes[1];
  crcInput.set(payload, 2);
  var crcCalc = crc16(crcInput);
  var crcOk = (crcRecv === crcCalc);

  var text = utf8Decode(payload);
  var agreement = votesRead > 0 ? agreeCount / votesRead : 0; // [2/3, 1]
  var confidence;
  if (crcOk) confidence = Math.round(agreement * 100);          // ~100（干净）/ 略低（噪但还原）
  else confidence = Math.round(agreement * 50);                 // CRC 失败 → 压低
  if (confidence > 100) confidence = 100;

  return {
    ok: crcOk,
    syncOk: true,
    crcOk: crcOk,
    text: text,
    confidence: confidence,
    status: crcOk ? 'ok' : 'corrupt'
  };
}

module.exports = {
  // 通道编解码
  embed: embed,
  extract: extract,
  maxPayloadBytes: maxPayloadBytes,
  // 帧编解码
  frameMessage: frameMessage,
  // 比特工具
  bytesToBits: bytesToBits,
  bitsToBytes: bitsToBytes,
  // 编解码原语（供测试交叉验证）
  utf8Encode: utf8Encode,
  utf8Decode: utf8Decode,
  crc16: crc16,
  hashSeed: hashSeed,
  mulberry32: mulberry32,
  makePositionGen: makePositionGen,
  // 常量
  SYNC_BYTES: SYNC_BYTES,
  REDUNDANCY: REDUNDANCY,
  HEADER_BITS: HEADER_BITS
};
