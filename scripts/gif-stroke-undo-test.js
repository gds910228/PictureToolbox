// scripts/gif-stroke-undo-test.js
// 擦除作用域 + 区域快照撤销算法验证（零 npm 依赖，node 直接运行）。
//
// 页面层 gifEditor.js 的 _beginEraseStroke/_commitEraseStroke/undoErase/redoErase
// 依赖 wx 无法直接 node require，本脚本以逐行同构的最小 mock 复现该算法，
// 用真实 utils/gif-frame-ops.js 函数验证语义：
//   1. 单帧笔画：擦除→undo==原始→redo==擦除后
//   2. 全部帧笔画：擦除→任一帧 undo→所有帧回退→redo 联动恢复
//   3. 混合笔画：全部帧笔 A + 帧X单帧笔 B → 其他帧 undo A 时帧 X 的 B 保留（B 区域内）
//   4. bbox 并集正确覆盖插值多点
//   5. 撤销栈深度上限
//   6. 存量 bug 回归：undo 必须真正回退（旧实现 touchend 压栈=空操作）
//
// 运行：node scripts/gif-stroke-undo-test.js

'use strict';

const path = require('path');
const { eraseCircle, snapshotRect, restoreRect, cloneFrame } =
  require(path.join(__dirname, '..', 'utils', 'gif-frame-ops.js'));

const UNDO_LIMIT = 10;
let pass = 0, fail = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; failures.push(msg); console.error('  ✗ ' + msg); }
}

// ---- 与 gifEditor.js 同构的最小页面 mock ----
function makePage(framesCount, W, H) {
  const page = {
    data: { eraseScope: 'current', currentFrame: 0, eraserSize: 12, gifWidth: W, gifHeight: H },
    _frames: [],
    _strokeSeq: 0,
    _strokeBBox: null,
    _strokeBase: null,
    _strokeFrameIdx: -1,
    _eraseStrokes: [],
  };
  for (let i = 0; i < framesCount; i++) {
    const rgba = new Uint8Array(W * H * 4);
    // 每帧填充不同基色（帧索引 + 通道梯度），便于检测错帧
    for (let p = 0; p < W * H; p++) {
      rgba[p * 4] = (i * 40 + p % 251) % 256;
      rgba[p * 4 + 1] = (i * 80 + (p * 7) % 251) % 256;
      rgba[p * 4 + 2] = (i * 120 + (p * 13) % 251) % 256;
      rgba[p * 4 + 3] = 255;
    }
    page._frames.push({ rgba, undoStack: [], redoStack: [] });
  }
  page._originals = page._frames.map(f => cloneFrame(f.rgba));
  return page;
}

// ↓↓↓ 以下五个函数与 pages/gifEditor/gifEditor.js 同构（去掉 setData/渲染副作用） ↓↓↓

function _eraseAtPoint(page, cx, cy) {
  const r = Math.round(page.data.eraserSize / 2);
  const W = page.data.gifWidth, H = page.data.gifHeight;
  if (page._strokeScope === 'all') {
    let touched = false;
    for (let i = 0; i < page._frames.length; i++) {
      const bbox = eraseCircle(page._frames[i].rgba, W, H, cx, cy, r);
      if (bbox) { touched = true; _unionStrokeBBox(page, bbox); }
    }
    if (!touched) return;
    page._eraseStrokes.push({ frame: -1, cx, cy, r });
  } else {
    const frame = page._frames[page._strokeFrameIdx];
    if (!frame) return;
    const bbox = eraseCircle(frame.rgba, W, H, cx, cy, r);
    if (!bbox) return;
    _unionStrokeBBox(page, bbox);
    page._eraseStrokes.push({ frame: page._strokeFrameIdx, cx, cy, r });
  }
}

function _beginEraseStroke(page) {
  page._strokeBBox = null;
  page._strokeSeq = page._strokeSeq + 1;
  page._strokeScope = page.data.eraseScope;
  if (page._strokeScope === 'all') {
    page._strokeBase = page._frames.map(f => cloneFrame(f.rgba));
    page._strokeFrameIdx = -1;
  } else {
    page._strokeFrameIdx = page.data.currentFrame;
    const frame = page._frames[page._strokeFrameIdx];
    page._strokeBase = frame ? cloneFrame(frame.rgba) : null;
  }
}

function _unionStrokeBBox(page, bbox) {
  if (!page._strokeBBox) {
    page._strokeBBox = { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h };
    return;
  }
  const b = page._strokeBBox;
  const x2 = Math.max(b.x + b.w, bbox.x + bbox.w);
  const y2 = Math.max(b.y + b.h, bbox.y + bbox.h);
  b.x = Math.min(b.x, bbox.x);
  b.y = Math.min(b.y, bbox.y);
  b.w = x2 - b.x;
  b.h = y2 - b.y;
}

function _commitEraseStroke(page) {
  if (!page._strokeBBox || !page._strokeBase) {
    page._strokeBase = null;
    page._strokeBBox = null;
    return;
  }
  const bbox = page._strokeBBox;
  const strokeId = page._strokeSeq;
  const W = page.data.gifWidth, H = page.data.gifHeight;
  if (page._strokeScope === 'all') {
    for (let i = 0; i < page._frames.length; i++) {
      _pushFrameUndo(page._frames[i], page._strokeBase[i], bbox, strokeId, W, H);
    }
  } else {
    const frame = page._frames[page._strokeFrameIdx];
    if (frame) _pushFrameUndo(frame, page._strokeBase, bbox, strokeId, W, H);
  }
  page._strokeBase = null;
  page._strokeBBox = null;
}

function _pushFrameUndo(frame, baseRgba, bbox, strokeId, W, H) {
  if (!frame || !baseRgba || baseRgba.length !== frame.rgba.length) return;
  const snap = snapshotRect(baseRgba, W, H, bbox.x, bbox.y, bbox.w, bbox.h);
  frame.undoStack.push({ x: snap.x, y: snap.y, w: snap.w, h: snap.h, data: snap.data, strokeId: strokeId });
  if (frame.undoStack.length > UNDO_LIMIT) frame.undoStack.shift();
  frame.redoStack = [];
}

function _restoreEntry(page, frame, entry, direction) {
  const W = page.data.gifWidth, H = page.data.gifHeight;
  if (!frame || !entry || frame.rgba.length !== W * H * 4) return;
  const current = snapshotRect(frame.rgba, W, H, entry.x, entry.y, entry.w, entry.h);
  restoreRect(frame.rgba, W, entry);
  const stack = direction === 'redo' ? frame.redoStack : frame.undoStack;
  stack.push({ x: current.x, y: current.y, w: current.w, h: current.h, data: current.data, strokeId: entry.strokeId });
  if (stack.length > UNDO_LIMIT) stack.shift();
}

function _pullLinkedEntry(frame, strokeId, stackName) {
  const stack = frame[stackName];
  const idx = stack.findIndex(en => en.strokeId === strokeId);
  return idx >= 0 ? stack.splice(idx, 1)[0] : null;
}

function undoErase(page) {
  const frame = page._frames[page.data.currentFrame];
  if (!frame || frame.undoStack.length === 0) return;
  const entry = frame.undoStack.pop();
  _restoreEntry(page, frame, entry, 'redo');
  if (entry.strokeId !== undefined) {
    for (let i = 0; i < page._frames.length; i++) {
      if (i === page.data.currentFrame) continue;
      const linked = _pullLinkedEntry(page._frames[i], entry.strokeId, 'undoStack');
      if (linked) _restoreEntry(page, page._frames[i], linked, 'redo');
    }
  }
}

function redoErase(page) {
  const frame = page._frames[page.data.currentFrame];
  if (!frame || frame.redoStack.length === 0) return;
  const entry = frame.redoStack.pop();
  _restoreEntry(page, frame, entry, 'undo');
  if (entry.strokeId !== undefined) {
    for (let i = 0; i < page._frames.length; i++) {
      if (i === page.data.currentFrame) continue;
      const linked = _pullLinkedEntry(page._frames[i], entry.strokeId, 'redoStack');
      if (linked) _restoreEntry(page, page._frames[i], linked, 'undo');
    }
  }
}
// ↑↑↑ 同构算法结束 ↑↑↑

// 模拟一次完整涂抹（touchstart → 插值多点 → touchend）
function stroke(page, points) {
  _beginEraseStroke(page);
  for (const [cx, cy] of points) _eraseAtPoint(page, cx, cy);
  _commitEraseStroke(page);
}

function sameRgba(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function diffPixels(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++;
  }
  return n;
}

const PAGE_W = 64, PAGE_H = 48;

console.log('[1] 单帧笔画：擦除→undo==原始→redo==擦除后');
{
  const page = makePage(3, PAGE_W, PAGE_H);
  page.data.currentFrame = 1;
  const before = cloneFrame(page._frames[1].rgba);
  stroke(page, [[20, 20], [24, 22], [28, 25]]);
  ok(diffPixels(page._frames[1].rgba, before) > 0, '1.1 涂抹产生了像素变化');
  ok(sameRgba(page._frames[0].rgba, page._originals[0]), '1.2 其他帧 0 未被影响');
  ok(sameRgba(page._frames[2].rgba, page._originals[2]), '1.3 其他帧 2 未被影响');
  undoErase(page);
  ok(sameRgba(page._frames[1].rgba, before), '1.4 undo 后当前帧完全恢复原始（存量 bug 回归：旧实现为空操作）');
  redoErase(page);
  ok(diffPixels(page._frames[1].rgba, before) > 0, '1.5 redo 后重新擦除');
}

console.log('[2] 全部帧笔画：任一帧 undo → 所有帧联动回退 → redo 联动恢复');
{
  const page = makePage(4, PAGE_W, PAGE_H);
  page.data.eraseScope = 'all';
  stroke(page, [[10, 10], [16, 14], [22, 18]]);
  for (let i = 0; i < 4; i++) {
    ok(diffPixels(page._frames[i].rgba, page._originals[i]) > 0, '2.' + (i + 1) + ' 帧 ' + i + ' 被擦除');
  }
  ok(page._eraseStrokes.every(s => s.frame === -1), '2.5 笔画记录 frame:-1（草稿重放标记）');
  page.data.currentFrame = 2; // 在帧 2 上按撤销
  undoErase(page);
  for (let i = 0; i < 4; i++) {
    ok(sameRgba(page._frames[i].rgba, page._originals[i]), '2.6.' + i + ' 帧 ' + i + ' 联动回退到原始');
  }
  redoErase(page);
  for (let i = 0; i < 4; i++) {
    ok(diffPixels(page._frames[i].rgba, page._originals[i]) > 0, '2.7.' + i + ' 帧 ' + i + ' redo 联动恢复擦除');
  }
}

console.log('[3] 混合笔画：全部帧笔 A + 帧0单帧笔 B → 帧1 undo A 时帧0 的 B 区域保留');
{
  const page = makePage(3, PAGE_W, PAGE_H);
  page.data.eraseScope = 'all';
  stroke(page, [[8, 8], [12, 10]]);          // A：全部帧，左上区域
  page.data.eraseScope = 'current';
  page.data.currentFrame = 0;
  stroke(page, [[40, 30], [44, 33]]);        // B：仅帧0，右下区域（与 A 不重叠）
  // 帧 1 上撤销 A
  page.data.currentFrame = 1;
  undoErase(page);
  ok(sameRgba(page._frames[1].rgba, page._originals[1]), '3.1 帧1 回退 A 后为原始');
  ok(sameRgba(page._frames[2].rgba, page._originals[2]), '3.2 帧2 回退 A 后为原始');
  // 帧 0：A 回退，B 保留 → 帧0 == 原始 + B 的擦除
  const expected = cloneFrame(page._originals[0]);
  eraseCircle(expected, PAGE_W, PAGE_H, 40, 30, 6);
  eraseCircle(expected, PAGE_W, PAGE_H, 44, 33, 6);
  ok(sameRgba(page._frames[0].rgba, expected), '3.3 帧0 = 原始+B（A 联动回退、B 保留）');
  // 帧 0 自身 undo B 仍可用
  page.data.currentFrame = 0;
  undoErase(page);
  ok(sameRgba(page._frames[0].rgba, page._originals[0]), '3.4 帧0 再 undo B 回到原始');
}

console.log('[4] bbox 并集覆盖插值多点（远距离两点之间整条路径）');
{
  const page = makePage(1, PAGE_W, PAGE_H);
  page.data.currentFrame = 0;
  stroke(page, [[5, 5], [40, 30]]); // 两点相距远，bbox 应覆盖整条带状区域
  const b = page._frames[0].undoStack[0];
  ok(b.x <= 0 && b.y <= 0, '4.1 bbox x/y clamp 到画布（含笔半径）');
  ok(b.w >= 40 && b.h >= 30, '4.2 bbox 宽高覆盖两点跨度');
  undoErase(page);
  ok(sameRgba(page._frames[0].rgba, page._originals[0]), '4.3 bbox 区域恢复后整帧与原始一致');
}

console.log('[5] 撤销栈深度上限');
{
  const page = makePage(1, PAGE_W, PAGE_H);
  page.data.currentFrame = 0;
  for (let i = 0; i < UNDO_LIMIT + 5; i++) stroke(page, [[10 + i, 10], [14 + i, 12]]);
  ok(page._frames[0].undoStack.length === UNDO_LIMIT, '5.1 栈深封顶 ' + UNDO_LIMIT + '（实际=' + page._frames[0].undoStack.length + '）');
  for (let i = 0; i < UNDO_LIMIT; i++) undoErase(page);
  // 前 5 笔已被挤出，只能回退到第 6 笔之前的状态
  const expected = cloneFrame(page._originals[0]);
  for (let i = 0; i < 5; i++) {
    eraseCircle(expected, PAGE_W, PAGE_H, 10 + i, 10, 6);
    eraseCircle(expected, PAGE_W, PAGE_H, 14 + i, 12, 6);
  }
  ok(sameRgba(page._frames[0].rgba, expected), '5.2 回退到第 6 笔前状态（前 5 笔不可回退，符合上限语义）');
}

console.log('[6] 画布外笔画不入栈不崩溃');
{
  const page = makePage(2, PAGE_W, PAGE_H);
  page.data.currentFrame = 0;
  stroke(page, [[-50, -50], [-60, -70]]);
  ok(page._frames[0].undoStack.length === 0, '6.1 完全画布外笔画不产生撤销 entry');
  ok(sameRgba(page._frames[0].rgba, page._originals[0]), '6.2 帧未被修改');
}

console.log('[7] 笔画中途切换作用域 chip（多指误触）——起笔时锁定，undo 不丢');
{
  const page = makePage(3, PAGE_W, PAGE_H);
  page.data.eraseScope = 'current';
  page.data.currentFrame = 1;
  // touchstart（current scope 锁定）→ 中途 scope 被切到 all → touchend
  _beginEraseStroke(page);
  _eraseAtPoint(page, 20, 20);
  page.data.eraseScope = 'all';   // 模拟中途误触 chip
  _eraseAtPoint(page, 24, 22);
  _commitEraseStroke(page);
  ok(page._frames[1].undoStack.length === 1, '7.1 起笔帧仍有撤销 entry（不会被 all 分支吞掉）');
  ok(page._frames[0].undoStack.length === 0 && page._frames[2].undoStack.length === 0,
    '7.2 其他帧未被误擦（笔画按锁定 scope 只作用于帧 1）');
  undoErase(page);
  ok(sameRgba(page._frames[1].rgba, page._originals[1]), '7.3 undo 正常回退');
}

console.log('\n=== Results ===');
console.log('PASS: ' + pass);
console.log('FAIL: ' + fail);
if (fail > 0) {
  console.error('\nFailed assertions:');
  failures.forEach(m => console.error('  - ' + m));
  process.exit(1);
}
console.log('\n✓ All stroke-undo algorithm tests passed.');
