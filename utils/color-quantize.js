// utils/color-quantize.js
// 图像主色提取：Median Cut（中位切分）颜色量化 + 色值转换工具。
// 纯函数、无 wx 依赖、无副作用，便于离线测试与跨页面复用。
//
// 为什么选 Median Cut 而非裸 K-means：
//  - K-means 迭代次数不可控、对初始质心敏感、结果不稳定，小程序主线程上易卡顿；
//  - Median Cut 是确定性分治算法，O(n log n) 级、无需迭代，结果可复现；
//  - 配合"先降采样"后像素量已很小（≤数万），中位切分性能足够。
//
// 设计：算法（medianCut）与展示（buildPalette 拼装 hex/hsl/百分比）均在此文件，
// 但与任何 wx / DOM API 解耦——页面只负责取像素和渲染。

/**
 * RGB → HEX 字符串（大写，含 #）
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 * @returns {string} 形如 #1A2B3C
 */
function rgbToHex(r, g, b) {
  const h = (v) => {
    const s = (v & 0xff).toString(16);
    return s.length === 1 ? '0' + s : s;
  };
  return ('#' + h(r) + h(g) + h(b)).toUpperCase();
}

/**
 * HEX → {r,g,b}
 * @param {string} hex
 * @returns {{r:number,g:number,b:number}}
 */
function hexToRgb(hex) {
  let s = String(hex).replace('#', '');
  if (s.length === 3) {
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  }
  return {
    r: parseInt(s.slice(0, 2), 16) || 0,
    g: parseInt(s.slice(2, 4), 16) || 0,
    b: parseInt(s.slice(4, 6), 16) || 0
  };
}

/**
 * RGB → HSL
 * @returns {{h:number,s:number,l:number}} h:0-360, s:0-100, l:0-100
 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/**
 * 感知亮度（Rec. 601 加权），用于判定色块上文字该用深色还是浅色
 * @returns {number} 0-255
 */
function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 根据背景色返回对比度更高的文字色（黑/白）
 * @returns {string} '#111111' 或 '#FFFFFF'
 */
function contrastText(r, g, b) {
  return luminance(r, g, b) > 140 ? '#111111' : '#FFFFFF';
}

/**
 * 加权色彩距离平方（比纯欧氏更贴近人眼感知），仅用于去重/比较，无需开方
 */
function colorDist2(r1, g1, b1, r2, g2, b2) {
  const rmean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db;
}

/**
 * 计算一个 box 的三通道范围
 * @param {Int32Array} px 打包后的像素（每元素 = (r<<16)|(g<<8)|b）
 * @returns {{max:number,channel:number}} max=最长通道跨度，channel=该通道索引(0=r,1=g,2=b)
 */
function _boxRange(px) {
  let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
  for (let i = 0; i < px.length; i++) {
    const v = px[i];
    const r = (v >> 16) & 0xff;
    const g = (v >> 8) & 0xff;
    const b = v & 0xff;
    if (r < rmin) rmin = r;
    if (r > rmax) rmax = r;
    if (g < gmin) gmin = g;
    if (g > gmax) gmax = g;
    if (b < bmin) bmin = b;
    if (b > bmax) bmax = b;
  }
  const rr = rmax - rmin;
  const gr = gmax - gmin;
  const br = bmax - bmin;
  let max = rr;
  let channel = 0;
  if (gr > max) { max = gr; channel = 1; }
  if (br > max) { max = br; channel = 2; }
  return { max, channel };
}

/**
 * 按最长通道的中位数切分一个 box
 * @returns {{left:{px:Int32Array,range:object},right:{px:Int32Array,range:object}}|null}
 *   无法切分（像素<2）时返回 null
 */
function _splitBox(box) {
  const px = box.px;
  if (px.length < 2) return null;
  const shift = box.range.channel === 0 ? 16 : (box.range.channel === 1 ? 8 : 0);
  // 拷贝后按该通道升序排序（Int32Array 无 sort 比较器便利，转 Array）
  const sorted = Array.prototype.slice.call(px).sort((a, b) => {
    return ((a >> shift) & 0xff) - ((b >> shift) & 0xff);
  });
  const mid = sorted.length >> 1;
  const left = new Int32Array(sorted.slice(0, mid));
  const right = new Int32Array(sorted.slice(mid));
  return { left: { px: left, range: _boxRange(left) }, right: { px: right, range: _boxRange(right) } };
}

/**
 * Median Cut 颜色量化
 * @param {Uint8Array|Array<number>} rgba 形如 [r,g,b,a, r,g,b,a, ...] 的像素数据
 * @param {number} count 目标颜色数（实际返回数可能 ≤ count：图中色数不足时自然收敛）
 * @returns {Array<{r:number,g:number,b:number,weight:number}>} 按权重降序的主色
 */
function medianCut(rgba, count) {
  if (!rgba || !rgba.length || count < 1) return [];

  // 1. 收集不透明像素，打包成 24-bit 整数（节省内存、加速排序比较）
  const tmp = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 125) continue; // 跳过近透明像素（PNG 透明区不应影响主色）
    tmp.push((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
  }
  if (!tmp.length) return [];
  let boxes = [{ px: new Int32Array(tmp), range: _boxRange(new Int32Array(tmp)) }];

  // 2. 反复切分"最长通道跨度最大"的 box，直到达到 count 或无可切分
  while (boxes.length < count) {
    let bi = 0;
    let best = boxes[0].range.max;
    for (let i = 1; i < boxes.length; i++) {
      if (boxes[i].range.max > best) {
        best = boxes[i].range.max;
        bi = i;
      }
    }
    if (best === 0) break; // 所有剩余 box 均为单色，无法继续细分
    const split = _splitBox(boxes[bi]);
    if (!split) break;
    boxes[bi] = split.left;
    boxes.push(split.right);
  }

  // 3. 每个 box 取平均色 + 像素权重
  const result = [];
  for (let i = 0; i < boxes.length; i++) {
    const px = boxes[i].px;
    const n = px.length;
    if (!n) continue;
    let sr = 0, sg = 0, sb = 0;
    for (let j = 0; j < n; j++) {
      const v = px[j];
      sr += (v >> 16) & 0xff;
      sg += (v >> 8) & 0xff;
      sb += v & 0xff;
    }
    result.push({
      r: Math.round(sr / n),
      g: Math.round(sg / n),
      b: Math.round(sb / n),
      weight: n
    });
  }
  result.sort((a, b) => b.weight - a.weight);
  return result;
}

/**
 * 便捷封装：从像素数据提取主色，并拼装好展示所需字段
 * @param {Uint8Array|Array<number>} rgba
 * @param {number} count
 * @returns {Array<object>} 每项含 {r,g,b,hex,rgbText,hsl,hslText,pct,textColor}
 *   - pct: 该色占比百分比（整数）
 *   - textColor: 该色块上文字应使用的对比色（'#111111' / '#FFFFFF'）
 */
function buildPalette(rgba, count) {
  const raw = medianCut(rgba, count);
  const total = raw.reduce((s, c) => s + c.weight, 0) || 1;
  return raw.map((c) => {
    const hex = rgbToHex(c.r, c.g, c.b);
    const hsl = rgbToHsl(c.r, c.g, c.b);
    const pct = Math.round((c.weight / total) * 100);
    return {
      r: c.r,
      g: c.g,
      b: c.b,
      hex,
      rgbText: 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')',
      hsl,
      hslText: 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)',
      pct,
      textColor: contrastText(c.r, c.g, c.b)
    };
  });
}

module.exports = {
  rgbToHex,
  hexToRgb,
  rgbToHsl,
  luminance,
  contrastText,
  colorDist2,
  medianCut,
  buildPalette
};
