// utils/gif-frame-ops.js
// 纯像素操作工具（无 wx/canvas 依赖，可被 node 直接 require 测试）。
// 供 GIF 编辑器的裁剪、擦除、文字定位等功能使用。

'use strict';

/**
 * 裁剪一帧 RGBA 数据，返回新尺寸的 Uint8Array。
 * @param {Uint8Array|Uint8ClampedArray} rgba 源帧（srcW*srcH*4）
 * @param {number} srcW 源宽
 * @param {number} srcH 源高
 * @param {number} x 裁剪左上角 x（会被 clamp 到合法范围）
 * @param {number} y 裁剪左上角 y
 * @param {number} w 裁剪宽
 * @param {number} h 裁剪高
 * @returns {Uint8Array} 裁剪后的帧（w*h*4）
 */
function cropFrame(rgba, srcW, srcH, x, y, w, h) {
  x = Math.max(0, Math.min(x, srcW - 1));
  y = Math.max(0, Math.min(y, srcH - 1));
  w = Math.max(1, Math.min(w, srcW - x));
  h = Math.max(1, Math.min(h, srcH - y));
  var out = new Uint8Array(w * h * 4);
  for (var row = 0; row < h; row++) {
    var srcStart = ((y + row) * srcW + x) * 4;
    var dstStart = row * w * 4;
    out.set(rgba.subarray(srcStart, srcStart + w * 4), dstStart);
  }
  return out;
}

/**
 * 深拷贝一帧 RGBA 数据。
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @returns {Uint8Array}
 */
function cloneFrame(rgba) {
  var out = new Uint8Array(rgba.length);
  out.set(rgba);
  return out;
}

/**
 * 在帧上擦除一个圆形区域（alpha 置 0，RGB 也清零）。
 * 直接修改传入的 rgba 数组。
 * @param {Uint8Array|Uint8ClampedArray} rgba 帧数据（w*h*4）
 * @param {number} w 帧宽
 * @param {number} h 帧高
 * @param {number} cx 圆心 x
 * @param {number} cy 圆心 y
 * @param {number} r 半径
 * @returns {{x:number,y:number,w:number,h:number}|null} 变化包围盒，无变化返回 null
 */
function eraseCircle(rgba, w, h, cx, cy, r) {
  var minX = w, minY = h, maxX = -1, maxY = -1;
  var r2 = r * r;
  var x0 = Math.max(0, Math.ceil(cx - r));
  var x1 = Math.min(w - 1, Math.floor(cx + r));
  var y0 = Math.max(0, Math.ceil(cy - r));
  var y1 = Math.min(h - 1, Math.floor(cy + r));
  for (var y = y0; y <= y1; y++) {
    for (var x = x0; x <= x1; x++) {
      var dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        var i = (y * w + x) * 4;
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 提取帧的一个矩形区域（用于撤销快照）。
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number} w 帧宽
 * @param {number} h 帧高
 * @param {number} x
 * @param {number} y
 * @param {number} rw
 * @param {number} rh
 * @returns {{x:number,y:number,w:number,h:number,data:Uint8Array}}
 */
function snapshotRect(rgba, w, h, x, y, rw, rh) {
  x = Math.max(0, x);
  y = Math.max(0, y);
  rw = Math.min(rw, w - x);
  rh = Math.min(rh, h - y);
  var data = new Uint8Array(rw * rh * 4);
  for (var row = 0; row < rh; row++) {
    var srcStart = ((y + row) * w + x) * 4;
    data.set(rgba.subarray(srcStart, srcStart + rw * 4), row * rw * 4);
  }
  return { x: x, y: y, w: rw, h: rh, data: data };
}

/**
 * 恢复一个矩形快照（撤销用）。
 * @param {Uint8Array|Uint8ClampedArray} rgba 目标帧
 * @param {number} w 目标帧宽
 * @param {{x:number,y:number,w:number,h:number,data:Uint8Array}} snap
 */
function restoreRect(rgba, w, snap) {
  for (var row = 0; row < snap.h; row++) {
    var dstStart = ((snap.y + row) * w + snap.x) * 4;
    rgba.set(snap.data.subarray(row * snap.w * 4, (row + 1) * snap.w * 4), dstStart);
  }
}

/**
 * 九宫格定位：给定画布尺寸和文本块尺寸，返回文本左上角坐标。
 * @param {number} cw 画布宽
 * @param {number} ch 画布高
 * @param {number} tw 文本块宽
 * @param {number} th 文本块高
 * @param {string} pos 九宫格位置：'tl','tc','tr','ml','mc','mr','bl','bc','br'
 * @param {number} [pad] 边距，默认 12
 * @returns {{x:number,y:number}}
 */
function nineGridPosition(cw, ch, tw, th, pos, pad) {
  pad = pad || 12;
  var x, y;
  if (pos.indexOf('l') >= 0) x = pad;
  else if (pos.indexOf('r') >= 0) x = cw - tw - pad;
  else x = (cw - tw) / 2;
  if (pos.indexOf('t') >= 0) y = pad;
  else if (pos.indexOf('b') >= 0) y = ch - th - pad;
  else y = (ch - th) / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * 测量多行文本的包围盒尺寸（近似，不依赖 canvas）。
 * 用于九宫格定位和导出时的 dirty-rect 计算。
 * @param {string} text
 * @param {number} fontSize
 * @param {number} [lineHeight] 行高倍数，默认 1.2
 * @returns {{w:number,h:number,lines:string[]}}
 */
function measureText(text, fontSize, lineHeight) {
  lineHeight = lineHeight || 1.2;
  var lines = String(text).split('\n');
  var maxLen = 0;
  for (var i = 0; i < lines.length; i++) {
    // 中文/全角字符约 1em，ASCII 约 0.6em（近似）
    var w = 0;
    for (var j = 0; j < lines[i].length; j++) {
      var code = lines[i].charCodeAt(j);
      w += code > 255 ? fontSize : fontSize * 0.6;
    }
    if (w > maxLen) maxLen = w;
  }
  return {
    w: Math.ceil(maxLen),
    h: Math.ceil(lines.length * fontSize * lineHeight),
    lines: lines
  };
}

module.exports = {
  cropFrame: cropFrame,
  cloneFrame: cloneFrame,
  eraseCircle: eraseCircle,
  snapshotRect: snapshotRect,
  restoreRect: restoreRect,
  nineGridPosition: nineGridPosition,
  measureText: measureText
};
