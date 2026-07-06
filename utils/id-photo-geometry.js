// utils/id-photo-geometry.js
// 证件照几何：由 DetectFace 返回 + 原图尺寸 + 目标规格，算出把【抠图PNG】合成到规格画布的 canvas 变换参数。
// 纯函数，不依赖 wx，可在 node 直接单测（符合验收点）。
//
// 证件照规范（近似）：
//   - 人脸框（眼-下巴）高度 ≈ 照片高度的 faceHeightRatio（默认 0.5）
//   - 人脸中心垂直位置 ≈ faceCenterYRatio（默认 0.42，略偏上，给下巴/肩留空）
//   - 头顶留白由 faceCenterYRatio - faceHeightRatio/2 间接给出（默认 ≈0.17）
// 这些是可调参数，不同规格/标准可微调。

const DEFAULTS = {
  faceHeightRatio: 0.5,
  faceCenterYRatio: 0.42
};

/**
 * 计算带 roll 校正的合成变换
 * @param {{x,y,width,height}} face 人脸框（原图坐标系）
 * @param {number} roll 平面旋转角（度），将反向旋转以校正面部水平
 * @param {number} srcW 抠图PNG宽（=原图宽）
 * @param {number} srcH 抠图PNG高（=原图高）
 * @param {number} specW 目标规格画布宽
 * @param {number} specH 目标规格画布高
 * @returns {{scale,rotateDeg,faceCx,faceCy,targetCx,targetCy,srcW,srcH,specW,specH}}
 *   canvas 用法：
 *     ctx.save();
 *     ctx.translate(t.targetCx, t.targetCy);
 *     ctx.rotate(t.rotateDeg * Math.PI / 180);
 *     ctx.scale(t.scale, t.scale);
 *     ctx.drawImage(cutout, -t.faceCx, -t.faceCy, t.srcW, t.srcH);
 *     ctx.restore();
 */
function computeCompositeTransform(face, roll, srcW, srcH, specW, specH, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const faceH = (face && face.height) || 1;
  const scale = (o.faceHeightRatio * specH) / faceH;
  const faceCx = face.x + (face.width || 0) / 2;
  const faceCy = face.y + faceH / 2;
  return {
    scale,
    rotateDeg: -(roll || 0),
    faceCx, faceCy,
    targetCx: specW / 2,
    targetCy: o.faceCenterYRatio * specH,
    srcW, srcH, specW, specH
  };
}

/**
 * 无人脸时的中心裁剪框（按规格宽高比，居中取最大区域）
 * @returns {{sx,sy,sw,sh}} 原图裁剪源框
 */
function computeCenterCrop(srcW, srcH, specW, specH) {
  const targetRatio = specW / specH;
  const srcRatio = srcW / srcH;
  let sw, sh, sx, sy;
  if (srcRatio > targetRatio) {
    // 原图偏宽 → 按高度裁
    sh = srcH;
    sw = srcH * targetRatio;
    sx = (srcW - sw) / 2;
    sy = 0;
  } else {
    sw = srcW;
    sh = srcW / targetRatio;
    sx = 0;
    sy = (srcH - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

module.exports = { computeCompositeTransform, computeCenterCrop, DEFAULTS };
