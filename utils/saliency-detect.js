// utils/saliency-detect.js
// 本地「简单主体定位」：基于边缘能量质心的主体定位（真实算法，非伪造 AI）。
//
// 思路：
//   1) 把图降采样到 ~96px（控性能/内存）
//   2) 逐像素计算「能量」= 梯度幅值（与右/下邻像素差的绝对值之和）
//      —— 边缘/纹理强的区域能量高，通常对应主体轮廓
//   3) 以能量为权重求质心 (cx, cy) 与加权标准差 → 主体半径
//   4) 输出归一化 bbox {x, y, w, h}（0~1），与云端返回格式一致
//
// 退化：能量极低（纯色/平坦图）→ 质心趋近图中心，半径取保守值 → 等效中心裁剪。
// 诚实标注：UI 文案应写「智能主体定位（本地算法）」，不得宣称神经网络/AI 识别。
//
// 输出与云端检测同构：{ x, y, w, h, source }（0~1 归一化）

const { getImageInfo } = require('./image-process');

const SAMPLE_EDGE = 96;            // 降采样最长边
const MIN_RADIUS_RATIO = 0.28;     // 半径下限（相对短边），避免框过小

/**
 * 本地主体定位，返回归一化 bbox。
 * @param {string} filePath 图片临时路径
 * @returns {Promise<{x:number,y:number,w:number,h:number,source:'local'}>}
 */
function detectSubject(filePath) {
  return new Promise((resolve) => {
    getImageInfo(filePath).then((info) => {
      const { width: W, height: H, path } = info;
      const longest = Math.max(W, H);
      const scale = longest > SAMPLE_EDGE ? SAMPLE_EDGE / longest : 1;
      const sw = Math.max(8, Math.round(W * scale));
      const sh = Math.max(8, Math.round(H * scale));

      const canvas = wx.createOffscreenCanvas({ type: '2d', width: sw, height: sh });
      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();
      image.onload = () => {
        ctx.drawImage(image, 0, 0, sw, sh);
        let data;
        try {
          data = ctx.getImageData(0, 0, sw, sh).data;
        } catch (e) {
          console.warn('[saliency-detect] getImageData 失败，回退中心', e);
          resolve(_centerBox());
          return;
        }
        resolve(_centroidBox(data, sw, sh));
      };
      image.onerror = () => {
        console.warn('[saliency-detect] 图片加载失败，回退中心');
        resolve(_centerBox());
      };
      image.src = path;
    }).catch(() => resolve(_centerBox()));
  });
}

// 由像素数据算能量质心 + 半径 → 归一化 bbox
function _centroidBox(data, sw, sh) {
  const shortSide = Math.min(sw, sh);
  const energy = new Float32Array(sw * sh);
  let sum = 0, sx = 0, sy = 0;

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const hasRight = x + 1 < sw;
      const hasDown = y + 1 < sh;
      const ri = i + 4;          // 右邻像素索引
      const di = i + sw * 4;     // 下邻像素索引
      const rx = hasRight ? data[ri] : r;
      const gx = hasRight ? data[ri + 1] : g;
      const bx = hasRight ? data[ri + 2] : b;
      const rd = hasDown ? data[di] : r;
      const gd = hasDown ? data[di + 1] : g;
      const bd = hasDown ? data[di + 2] : b;
      const e = Math.abs(r - rx) + Math.abs(g - gx) + Math.abs(b - bx)
              + Math.abs(r - rd) + Math.abs(g - gd) + Math.abs(b - bd);
      energy[y * sw + x] = e;
      sum += e; sx += e * x; sy += e * y;
    }
  }

  // 能量极低 → 中心 50% 区域
  if (sum < 1e-3) return _centerBox();

  const cx = sx / sum;
  const cy = sy / sum;

  // 加权标准差 → 主体半径（2σ 覆盖约 95% 能量集中区域）
  let vx = 0, vy = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const e = energy[y * sw + x];
      vx += e * (x - cx) * (x - cx);
      vy += e * (y - cy) * (y - cy);
    }
  }
  const sdx = Math.sqrt(vx / sum);
  const sdy = Math.sqrt(vy / sum);
  const rx = Math.max(sdx * 2, shortSide * MIN_RADIUS_RATIO);
  const ry = Math.max(sdy * 2, shortSide * MIN_RADIUS_RATIO);

  // 归一化 + 夹紧到 [0,1]
  let bx0 = (cx - rx) / sw, by0 = (cy - ry) / sh;
  let bx1 = (cx + rx) / sw, by1 = (cy + ry) / sh;
  bx0 = Math.max(0, Math.min(1, bx0));
  by0 = Math.max(0, Math.min(1, by0));
  bx1 = Math.max(0, Math.min(1, bx1));
  by1 = Math.max(0, Math.min(1, by1));

  // 防止退化成一条线（宽或高过小则对称扩展）
  if (bx1 - bx0 < 0.2) { const c = (bx0 + bx1) / 2; bx0 = c - 0.1; bx1 = c + 0.1; }
  if (by1 - by0 < 0.2) { const c = (by0 + by1) / 2; by0 = c - 0.1; by1 = c + 0.1; }

  return {
    x: Math.max(0, bx0),
    y: Math.max(0, by0),
    w: Math.min(1, bx1) - Math.max(0, bx0),
    h: Math.min(1, by1) - Math.max(0, by0),
    source: 'local'
  };
}

function _centerBox() {
  return { x: 0.25, y: 0.25, w: 0.5, h: 0.5, source: 'local' };
}

module.exports = { detectSubject };
