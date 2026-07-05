// utils/format-recommend.js
// 图像格式推荐：启发式特征提取 + 规则推荐 + 体积区间估算。
// 纯函数、无 wx 依赖、无副作用，便于离线测试与跨页面复用。
//
// 设计原则（对应方案 A）：
//  - 推荐域含 JPG/PNG/WebP/AVIF 四种，但标注"可转换性"：
//    JPG/PNG 可在本工具内 Canvas 实转 + 实测算体积；
//    WebP/AVIF 仅给区间估算 + "需专业工具导出"提示（小程序 Canvas 不支持导出这两种）。
//  - 推荐必须给原因：每条 reason 引用具体特征（透明/颜色数/边缘/平坦区/类型）。
//  - 不臆造 AI 识别能力：类型判定是可解释的阈值规则，不是模型推理。
//  - 体积为"估算"区间（±20%），JPG/PNG 转换后以实测体积为准。
//
// 体积估算依据（行业经验值，非精确）：
//  JPG q80 照片 ≈ 0.8 bpp；截图 ≈ 1.6 bpp（锐边多、难压）；图标 ≈ 0.7 bpp。
//  PNG 无损：照片 ≈ 5 bpp；少色平坦 ≈ 0.6 bpp。
//  WebP 有损 ≈ JPG × 0.7（小 30%）；无损 ≈ PNG × 0.75（小 25%）。
//  AVIF 有损 ≈ JPG × 0.5（小 50%）。
//  平坦区占比越高越易压缩，用 flatAdj = 1 - flatRatio×0.4 线性下调。

const { medianCut } = require('./color-quantize');

// ---- 边缘/平坦阈值（基于 Rec.601 亮度差，经验值）----
const EDGE_THRESH = 28; // 邻域亮度差 > 28 视为边缘（文字/UI 锐边）
const FLAT_THRESH = 6;  // 四邻域亮度差均 < 6 视为平坦区（纯色背景）

// 亮度（Rec.601），用于边缘/平坦的邻域比较
function _lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 从 ImageData 像素提取图像特征（在降采样画布上运行，特征为尺度不变的比率/分档）
 * @param {Uint8Array} rgba [r,g,b,a, ...]
 * @param {number} width
 * @param {number} height
 * @returns {object} 特征对象，不含源图尺寸（尺寸由调用方传入用于体积估算）
 */
function extractFeatures(rgba, width, height) {
  if (!rgba || !rgba.length || width < 2 || height < 2) {
    return {
      hasAlpha: false, alphaRatio: 0,
      colorCount: 0, richColor: false,
      edgeDensity: 0, flatRatio: 0, avgGradient: 0,
      type: 'photo', photoScore: 1, screenshotScore: 0, iconScore: 0
    };
  }

  // 1. 透明通道统计（全图遍历，含边界）
  let alphaNonOpaque = 0;
  const totalPixels = width * height;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) alphaNonOpaque++;
  }
  const hasAlpha = alphaNonOpaque > 0;
  const alphaRatio = alphaNonOpaque / totalPixels;

  // 2. 边缘 / 平坦 / 渐变（仅内部不透明像素，透明像素 RGB 不可靠）
  let edgeCount = 0;
  let flatCount = 0;
  let gradientSum = 0;
  let interiorOpaque = 0;
  const rowBytes = width * 4;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3];
      if (a < 250) continue; // 跳过半透明/透明像素
      const lum0 = _lum(rgba[i], rgba[i + 1], rgba[i + 2]);

      const li = i - 4, ri = i + 4, ui = i - rowBytes, di = i + rowBytes;
      let dl = -1, dr = -1, du = -1, dd = -1;
      if (rgba[li + 3] >= 250) dl = Math.abs(lum0 - _lum(rgba[li], rgba[li + 1], rgba[li + 2]));
      if (rgba[ri + 3] >= 250) dr = Math.abs(lum0 - _lum(rgba[ri], rgba[ri + 1], rgba[ri + 2]));
      if (rgba[ui + 3] >= 250) du = Math.abs(lum0 - _lum(rgba[ui], rgba[ui + 1], rgba[ui + 2]));
      if (rgba[di + 3] >= 250) dd = Math.abs(lum0 - _lum(rgba[di], rgba[di + 1], rgba[di + 2]));

      // 至少需要两个有效邻域才有意义
      const valid = (dl >= 0 ? 1 : 0) + (dr >= 0 ? 1 : 0) + (du >= 0 ? 1 : 0) + (dd >= 0 ? 1 : 0);
      if (valid < 2) continue;
      interiorOpaque++;
      const validVals = [dl, dr, du, dd].filter((v) => v >= 0);
      const maxd = Math.max.apply(null, validVals);
      gradientSum += maxd;
      if (maxd > EDGE_THRESH) edgeCount++;
      if (dl >= 0 && dl < FLAT_THRESH && dr >= 0 && dr < FLAT_THRESH &&
          du >= 0 && du < FLAT_THRESH && dd >= 0 && dd < FLAT_THRESH) {
        flatCount++;
      }
    }
  }

  const edgeDensity = interiorOpaque > 0 ? edgeCount / interiorOpaque : 0;
  const flatRatio = interiorOpaque > 0 ? flatCount / interiorOpaque : 0;
  const avgGradient = interiorOpaque > 0 ? gradientSum / interiorOpaque : 0;

  // 3. 颜色数（medianCut 取 32 色分桶；收敛到 <32 说明图本身色数更少）
  const palette = medianCut(rgba, 32);
  const colorCount = palette.length;
  const richColor = colorCount >= 32; // =32 表示色数较多（≥32），照片类通常远超

  // 4. 类型打分（透明规则，可解释）
  let photoScore = 0, screenshotScore = 0, iconScore = 0;

  // 颜色丰富度
  if (richColor) photoScore += 3;
  else { screenshotScore += 1; iconScore += 2; }

  // 平坦区占比
  if (flatRatio > 0.55) { iconScore += 3; screenshotScore += 1; }
  else if (flatRatio > 0.35) { screenshotScore += 2; iconScore += 1; }
  else if (flatRatio > 0.15) { photoScore += 1; screenshotScore += 1; }
  else { photoScore += 3; } // 平坦区少 → 自然过渡多

  // 边缘密度（截图文字多抗锯齿，边缘密度通常 0.15-0.30；照片平滑 <0.15）
  if (edgeDensity > 0.30) screenshotScore += 3;       // 大量锐边 = 文字/UI
  else if (edgeDensity > 0.15) screenshotScore += 2;  // 中等边缘 = 含文字
  else photoScore += 2;                                // 边缘少 → 平滑渐变（照片）

  // 渐变平滑度（avgGradient 中等偏小但非 0 → 自然过渡）
  if (avgGradient > 5 && avgGradient < 25) photoScore += 1;

  // 透明通道 → 倾向图标/插画
  if (hasAlpha && alphaRatio > 0.02) iconScore += 2;

  let type = 'photo';
  let typeScore = photoScore;
  if (screenshotScore > typeScore) { type = 'screenshot'; typeScore = screenshotScore; }
  if (iconScore > typeScore) { type = 'icon'; typeScore = iconScore; }

  return {
    hasAlpha, alphaRatio,
    colorCount, richColor,
    edgeDensity, flatRatio, avgGradient,
    type, photoScore, screenshotScore, iconScore
  };
}

/**
 * 单格式体积区间估算（KB）
 * @param {object} features extractFeatures 产物
 * @param {string} format 'jpg'|'png'|'webp'|'avif'
 * @param {number|null} quality 质量（null 或 png 视为无损；webp>=100 视为无损）
 * @param {number} sourcePixels 源图像素数（用源图尺寸估算，非分析画布尺寸）
 * @returns {{minKB:number,maxKB:number,lossless:boolean}}
 */
function estimateSize(features, format, quality, sourcePixels) {
  const px = sourcePixels || 1;
  const flatAdj = Math.max(0.4, 1 - (features.flatRatio || 0) * 0.4);
  const type = features.type || 'photo';
  const rich = !!features.richColor;

  const isLossless = format === 'png' ||
    (format === 'webp' && (quality == null || quality >= 100));

  if (isLossless) {
    const bpp = rich ? 5 : (type === 'icon' ? 0.6 : 2.2);
    const kb = (px * bpp * flatAdj) / 1024;
    return { minKB: kb * 0.85, maxKB: kb * 1.2, lossless: true };
  }

  // 有损
  const base = type === 'screenshot' ? 1.6 : (type === 'icon' ? 0.7 : 0.8);
  const q = quality || 80;
  let factor = base * (q / 80); // 线性近似（实际非严格线性，区间容差吸收误差）
  if (format === 'webp') factor *= 0.7;      // 比 JPG 小 30%
  else if (format === 'avif') factor *= 0.5; // 比 JPG 小 50%
  const kb = (px * factor * flatAdj) / 1024;
  return { minKB: kb * 0.8, maxKB: kb * 1.2, lossless: false };
}

// 构造一条推荐项
function _mk(format, quality, reason, convertible, role) {
  return { format, quality, reason, convertible, role };
}

/**
 * 规则推荐
 * @param {object} features
 * @param {string} scenario 'wechat'|'web'|'storage'
 * @param {number} sourcePixels 源图像素数
 * @returns {{primary:object, alternatives:object[], scenario:string}}
 *   每项含 {format, quality, reason, convertible, role, size}
 */
function recommend(features, scenario, sourcePixels) {
  const { hasAlpha, type, alphaRatio } = features;
  const wechat = scenario === 'wechat';
  const candidates = [];

  if (hasAlpha && alphaRatio > 0.02) {
    // 含透明：JPG 不支持透明，排除
    if (wechat) {
      candidates.push(_mk('png', null, '检测到透明通道：PNG 无损且兼容微信，体积略大但最稳妥', true, 'primary'));
      candidates.push(_mk('webp', 90, 'WebP 同样支持透明且体积更小；部分老版微信显示需确认', false, 'alt'));
    } else {
      candidates.push(_mk('webp', 90, '检测到透明通道：WebP 有损/无损均支持，体积最优', false, 'primary'));
      candidates.push(_mk('avif', 60, 'AVIF 压缩率最高，但需现代平台解码', false, 'alt'));
      candidates.push(_mk('png', null, 'PNG 无损兼容性最好，体积较大', true, 'alt'));
    }
  } else if (type === 'icon') {
    // 图标/插画：颜色少、平坦区多 → 无损 PNG 最优
    candidates.push(_mk('png', null, '图标/插画类：颜色少、平坦区多，PNG 无损且体积小', true, 'primary'));
    if (wechat) {
      candidates.push(_mk('webp', 100, 'WebP 无损比 PNG 再小 20-30%（部分微信版本支持）', false, 'alt'));
    } else {
      candidates.push(_mk('webp', 100, 'WebP 无损比 PNG 再小 20-30%', false, 'alt'));
      candidates.push(_mk('avif', 60, 'AVIF 有损体积更小，但图标锐边可能失真', false, 'alt'));
    }
  } else if (type === 'screenshot') {
    // 截图：文字锐边 → PNG 保清晰；JPG 易出振铃
    if (wechat) {
      candidates.push(_mk('png', null, '截图含文字与锐边：PNG 无损不糊字，体积可接受', true, 'primary'));
      candidates.push(_mk('jpg', 90, 'JPG 体积更小，但文字边缘可能出现振铃', true, 'alt'));
    } else {
      candidates.push(_mk('png', null, '截图含文字：PNG 无损保清晰', true, 'primary'));
      candidates.push(_mk('webp', 90, 'WebP 兼顾体积与清晰度', false, 'alt'));
    }
  } else {
    // 照片
    if (wechat) {
      candidates.push(_mk('jpg', 80, '照片类：JPG 兼容性最好、体积小，适合微信传播', true, 'primary'));
      candidates.push(_mk('webp', 80, 'WebP 比 JPG 再小 25-35%（部分微信版本支持）', false, 'alt'));
    } else if (scenario === 'storage') {
      candidates.push(_mk('avif', 60, '归档场景：AVIF 压缩率最高，长期存储最省空间', false, 'primary'));
      candidates.push(_mk('webp', 80, 'WebP 体积/兼容性平衡好', false, 'alt'));
      candidates.push(_mk('jpg', 80, 'JPG 通用兜底', true, 'alt'));
    } else {
      // web
      candidates.push(_mk('webp', 80, '照片类：WebP 比 JPG 小 25-35%，现代浏览器全支持', false, 'primary'));
      candidates.push(_mk('avif', 60, 'AVIF 体积更优，但解码兼容性稍逊', false, 'alt'));
      candidates.push(_mk('jpg', 80, 'JPG 通用兜底', true, 'alt'));
    }
  }

  // 附加体积估算
  candidates.forEach((c) => {
    c.size = estimateSize(features, c.format, c.quality, sourcePixels);
  });

  const primary = candidates.find((c) => c.role === 'primary') || candidates[0];
  const alternatives = candidates.filter((c) => c.role !== 'primary');
  return { primary, alternatives, scenario };
}

module.exports = {
  extractFeatures,
  recommend,
  estimateSize
};
