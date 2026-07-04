// utils/image-hash.js - 感知哈希图片相似度（纯本地，零外部依赖）
//
// 实现 aHash(均值哈希) / dHash(差值哈希) / pHash(感知哈希,DCT) 三种轻量算法，
// 用于检测「近似重复图」——对 JPEG 压缩、尺寸缩放、轻微修改保持鲁棒。
//
// 能力边界（诚实声明）：
// - ✅ 识别：压缩后仍相似、缩放后仍相似、轻微裁剪/调色后仍相似、完全相同的图
// - ❌ 不识别：内容语义相似但像素布局不同（如同一人物不同姿势、同一风景不同角度）
//   那是 CLIP / 向量检索的范畴，属「云端语义增强版」扩展位，本首版不实现、不伪造。
//
// 设计要点：
// - 缩图到 32×32 灰度一次，三哈希共享像素数据，降低 IO
// - pHash 的 DCT 基矩阵预计算并缓存，避免重复 cos 运算
// - 批量串行 + 每张之间让出事件循环，控制内存占用、不卡 UI
// - 哈希以 hex 字符串返回（64bit → 16 字符），便于传输/存储/展示

const imageProcess = require('./image-process');

const EDGE = 32;            // 工作图边长（pHash DCT 尺寸）
const BLOCK = 8;            // 输出哈希 8×8 = 64bit
const HASH_HEX_LEN = 16;    // 64bit → 16 hex 字符

// 默认「疑似重复」判定阈值（pHash 汉明距离，0-64）。≤ 此值视为相似。
// 经验值：完全相同≈0，缩放/压缩后通常 1-6，重度修改 8-14，不同图 >20。
const DEFAULT_THRESHOLD = 12;

// -------------------------------------
// DCT-II 基矩阵预计算与缓存
// -------------------------------------
let _dctBasis = null;

function getDctBasis(N) {
  if (_dctBasis && _dctBasis._N === N) return _dctBasis;
  const basis = new Array(N);
  for (let u = 0; u < N; u++) {
    const row = new Array(N);
    const cu = u === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
    for (let x = 0; x < N; x++) {
      row[x] = cu * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
    }
    basis[u] = row;
  }
  basis._N = N;
  _dctBasis = basis;
  return basis;
}

// -------------------------------------
// 图片 → 灰度像素
// -------------------------------------

/**
 * 把任意尺寸图片缩放到 w×h，返回灰度像素数组（0-255）
 * @param {string} filePath 本地图片路径
 * @param {number} w
 * @param {number} h
 * @returns {Promise<Uint8Array>} 长度 w*h
 */
function toGray(filePath, w, h) {
  return new Promise((resolve, reject) => {
    imageProcess.getImageInfo(filePath).then((info) => {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();
      image.onload = () => {
        ctx.drawImage(image, 0, 0, w, h);
        let data;
        try {
          data = ctx.getImageData(0, 0, w, h).data;
        } catch (e) {
          reject(new Error('读取像素失败：' + (e && e.message)));
          return;
        }
        const gray = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const o = i * 4;
          // ITU-R BT.601 亮度加权
          gray[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) | 0;
        }
        resolve(gray);
      };
      image.onerror = (e) => reject(new Error('图片加载失败：' + (e && e.errMsg || '未知错误')));
      image.src = info.path || filePath;
    }).catch((err) => reject(err));
  });
}

// -------------------------------------
// 三种哈希
// -------------------------------------

/**
 * aHash（均值哈希）：32×32 → 4×4 均值池化到 8×8 → 全局均值二值化
 */
function aHashFromGray(gray) {
  const POOL = EDGE / BLOCK; // 4
  const small = new Array(BLOCK * BLOCK);
  let sum = 0;
  for (let by = 0; by < BLOCK; by++) {
    for (let bx = 0; bx < BLOCK; bx++) {
      let s = 0;
      for (let dy = 0; dy < POOL; dy++) {
        for (let dx = 0; dx < POOL; dx++) {
          s += gray[(by * POOL + dy) * EDGE + (bx * POOL + dx)];
        }
      }
      const avg = s / (POOL * POOL);
      small[by * BLOCK + bx] = avg;
      sum += avg;
    }
  }
  const mean = sum / (BLOCK * BLOCK);
  let bits = '';
  for (let i = 0; i < BLOCK * BLOCK; i++) bits += small[i] >= mean ? '1' : '0';
  return bitsToHex(bits);
}

/**
 * dHash（差值哈希）：从 32×32 抽样 8 行 × 9 列，水平相邻像素比较 → 64bit
 */
function dHashFromGray(gray) {
  // 8 行（均匀采样自 32 行）
  const rows = [];
  for (let i = 0; i < BLOCK; i++) rows.push(Math.round(i * (EDGE - 1) / (BLOCK - 1)));
  // 9 列（均匀采样自 32 列）
  const cols = [];
  for (let i = 0; i <= BLOCK; i++) cols.push(Math.round(i * (EDGE - 1) / BLOCK));
  let bits = '';
  for (let r = 0; r < rows.length; r++) {
    const y = rows[r];
    for (let x = 0; x < BLOCK; x++) {
      const left = gray[y * EDGE + cols[x]];
      const right = gray[y * EDGE + cols[x + 1]];
      bits += left < right ? '1' : '0';
    }
  }
  return bitsToHex(bits);
}

/**
 * pHash（感知哈希）：32×32 DCT → 取左上 8×8（排除 DC 分量）→ 均值二值化
 * 两步法 DCT：先对 x 做行变换，再对 y 做列变换，O(N³) 但 N=32 极快
 */
function pHashFromGray(gray) {
  const N = EDGE;
  const basis = getDctBasis(N);

  // 行变换：temp[u][y] = sum_x basis[u][x] * gray[x][y]
  const temp = new Array(N * N);
  for (let u = 0; u < N; u++) {
    const bu = basis[u];
    const offU = u * N;
    for (let y = 0; y < N; y++) {
      let s = 0;
      const offY = y * N;
      for (let x = 0; x < N; x++) s += bu[x] * gray[offY + x];
      temp[offU + y] = s;
    }
  }

  // 列变换：D[u][v] = sum_y basis[v][y] * temp[u][y]
  const D = new Array(N * N);
  for (let u = 0; u < N; u++) {
    const offU = u * N;
    for (let v = 0; v < N; v++) {
      const bv = basis[v];
      let s = 0;
      for (let y = 0; y < N; y++) s += bv[y] * temp[offU + y];
      D[offU + v] = s;
    }
  }

  // 取左上 8×8，排除 DC(D[0])，求均值
  let sum = 0;
  for (let u = 0; u < BLOCK; u++) {
    for (let v = 0; v < BLOCK; v++) sum += D[u * N + v];
  }
  const mean = (sum - D[0]) / (BLOCK * BLOCK - 1);

  let bits = '';
  for (let u = 0; u < BLOCK; u++) {
    for (let v = 0; v < BLOCK; v++) {
      if (u === 0 && v === 0) {
        bits += '0'; // DC 分量固定置 0，不参与比较
      } else {
        bits += D[u * N + v] > mean ? '1' : '0';
      }
    }
  }
  return bitsToHex(bits);
}

// -------------------------------------
// 哈希工具函数
// -------------------------------------

function bitsToHex(bits) {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * 两个 hex 哈希的汉明距离（不同 bit 数）
 */
function hammingDistance(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return 64;
  let d = 0;
  for (let i = 0; i < h1.length; i++) {
    let a = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    while (a) { d += a & 1; a >>= 1; }
  }
  return d;
}

/**
 * 汉明距离 → 归一化相似度分数 0-100
 * 0 距离=100 分（完全相同），64 距离=0 分
 */
function distanceToScore(dist) {
  const s = (1 - dist / 64) * 100;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * 根据分数给出文字等级（用于 UI 展示）
 */
function scoreLevel(score) {
  if (score >= 95) return { label: '极相似（疑似重复）', tone: 'dup' };
  if (score >= 85) return { label: '高度相似', tone: 'high' };
  if (score >= 70) return { label: '相似', tone: 'mid' };
  if (score >= 50) return { label: '略有相似', tone: 'low' };
  return { label: '不同', tone: 'diff' };
}

// -------------------------------------
// 对外 API
// -------------------------------------

/**
 * 计算单张图的三种哈希
 * @param {string} filePath
 * @returns {Promise<{aHash:string, dHash:string, pHash:string}>}
 */
async function computeHashes(filePath) {
  const gray = await toGray(filePath, EDGE, EDGE);
  return {
    aHash: aHashFromGray(gray),
    dHash: dHashFromGray(gray),
    pHash: pHashFromGray(gray)
  };
}

/**
 * 双图相似度对比
 * @param {string} pathA
 * @param {string} pathB
 * @returns {Promise<object>} { score, level, aDist, dDist, pDist }
 */
async function comparePair(pathA, pathB) {
  const [ha, hb] = await Promise.all([computeHashes(pathA), computeHashes(pathB)]);
  const aDist = hammingDistance(ha.aHash, hb.aHash);
  const dDist = hammingDistance(ha.dHash, hb.dHash);
  const pDist = hammingDistance(ha.pHash, hb.pHash);
  // 主分数用 pHash（对压缩/缩放/轻微修改最鲁棒）
  const score = distanceToScore(pDist);
  return { score, level: scoreLevel(score), aDist, dDist, pDist };
}

/**
 * 批量计算哈希（串行 + 让出事件循环，控制内存、不卡 UI）
 * @param {string[]} paths
 * @param {object} [opts] { onProgress(done,total), signal:{aborted} }
 * @returns {Promise<Array>} 每项 { index, path, aHash, dHash, pHash } 或 { index, path, error }
 */
async function runBatch(paths, opts = {}) {
  const { onProgress, signal } = opts;
  const results = [];
  for (let i = 0; i < paths.length; i++) {
    if (signal && signal.aborted) break;
    try {
      const h = await computeHashes(paths[i]);
      results.push({ index: i, path: paths[i], ...h });
    } catch (e) {
      // 单张失败不中断整批，降级为该项 error，UI 可单独提示
      results.push({ index: i, path: paths[i], error: (e && e.message) || String(e) });
    }
    if (onProgress) onProgress(i + 1, paths.length);
    // 让出事件循环，避免连续 canvas/像素操作阻塞渲染
    await new Promise((r) => setTimeout(r, 0));
  }
  return results;
}

/**
 * 把批量哈希结果按相似度分组（并查集）
 * @param {Array} hashes runBatch 的返回
 * @param {number} threshold pHash 汉明距离阈值，默认 12
 * @returns {object} { groups, duplicateGroupCount, duplicateCount, uniqueCount, errorCount }
 *   - groups: [{ isDuplicate, size, items:[{path, score, distToRep}] }]
 *     isDuplicate = size>1；组内按到组代表的距离升序
 */
function buildGroups(hashes, threshold = DEFAULT_THRESHOLD) {
  const ok = hashes.filter((h) => !h.error);
  const n = ok.length;

  // 并查集
  const parent = ok.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = hammingDistance(ok[i].pHash, ok[j].pHash);
      if (d <= threshold) union(i, j);
    }
  }

  // 收集组
  const groupMap = {};
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groupMap[r]) groupMap[r] = { repIdx: i, items: [] };
    const repIdx = groupMap[r].repIdx;
    const distToRep = hammingDistance(ok[i].pHash, ok[repIdx].pHash);
    groupMap[r].items.push({
      path: ok[i].path,
      score: distanceToScore(distToRep),
      distToRep
    });
  }

  const groups = Object.values(groupMap).map((g) => ({
    isDuplicate: g.items.length > 1,
    size: g.items.length,
    items: g.items.sort((a, b) => a.distToRep - b.distToRep)
  })).sort((a, b) => {
    // 重复组在前；组内按大小降序
    if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? -1 : 1;
    return b.size - a.size;
  });

  const duplicateGroupCount = groups.filter((g) => g.isDuplicate).length;
  const duplicateCount = groups.filter((g) => g.isDuplicate).reduce((s, g) => s + g.size, 0);
  const uniqueCount = groups.filter((g) => !g.isDuplicate).length;
  const errorCount = hashes.length - n;

  return { groups, duplicateGroupCount, duplicateCount, uniqueCount, errorCount };
}

module.exports = {
  EDGE,
  DEFAULT_THRESHOLD,
  computeHashes,
  comparePair,
  runBatch,
  buildGroups,
  hammingDistance,
  distanceToScore,
  scoreLevel
};
