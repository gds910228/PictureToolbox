#!/usr/bin/env node
/**
 * 分包迁移改写脚本（一次性，产物留档追溯）
 * 规则来源：request_analysis/spec.md §4/§5 + spec_review_v1~v3 修正
 *
 * A. pkgX 页面 require 主包 utils：`../../utils/T` → `../../../utils/T`
 *    （T ∈ MAIN：留主包的共享 utils；其余目标为包内 utils，两层不动）
 * B. 被迁 utils 自身内部 require 定点修（4 处，见 spec §4 表）
 * C. 路由路径改写：`'/pages/<page>/<page>` → `'/pkgX/pages/<page>/<page>`
 *    （覆盖 pages/ pkgX components/ 下 js+wxml 及 sitemap.json）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// 留主包的共享 utils（页面三层引用它们）
const MAIN = new Set([
  'analytics', 'content-check', 'image-process', 'compare-helper',
  'color-quantize', 'upscale-local'
]);

// 页面 → 分包 映射（24 页）
const PKG = {
  pkgAi: ['aiDescribe', 'aiCaption', 'aiMatting', 'aiStyle', 'aiOCR', 'aiEraser',
    'aiUpscale', 'aiColorize', 'aiChat', 'aiOutpaint', 'aiTextToImage', 'aiAvatar'],
  pkgGif: ['makeGif', 'gifEditor', 'gifBatch', 'gifReport', 'gifDrafts'],
  pkgTools: ['exif', 'similarity', 'formatRecommend', 'colorAnalysis',
    'hiddenWatermark', 'pdfToImage', 'imgToPdf'],
};

function walk(dir, exts, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (exts.some(x => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

const report = { A: [], B: [], C: [] };

/* ---------- A+B：require 改写 ---------- */
for (const pkg of Object.keys(PKG)) {
  for (const f of walk(path.join(ROOT, pkg), ['.js'], [])) {
    let src = fs.readFileSync(f, 'utf8');
    let n = 0;
    src = src.replace(/require\((['"])((?:\.\.\/)+utils\/)([A-Za-z0-9_-]+(?:\.js)?)\1\)/g,
      (m, q, dots, target) => {
        const base = target.replace(/\.js$/, '');
        if (dots === '../../utils/' && MAIN.has(base)) {
          n++;
          return `require(${q}../../../utils/${target}${q})`;
        }
        return m; // 包内 utils（两层）或已正确的三层，不动
      });
    if (n) {
      fs.writeFileSync(f, src);
      report.A.push(`${path.relative(ROOT, f)}: ${n}`);
    }
  }
}

const INTERNAL = [
  ['pkgAi/utils/colorize-detect.js', "require('./image-process')", "require('../../utils/image-process')"],
  ['pkgTools/utils/image-hash.js', "require('./image-process')", "require('../../utils/image-process')"],
  ['pkgTools/utils/format-recommend.js', "require('./color-quantize')", "require('../../utils/color-quantize')"],
  ['pkgGif/utils/gif-encoder.js', "require('./color-quantize.js')", "require('../../utils/color-quantize.js')"],
];
for (const [rel, from, to] of INTERNAL) {
  const f = path.join(ROOT, rel);
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes(from)) throw new Error(`B 失败：${rel} 找不到 ${from}`);
  fs.writeFileSync(f, src.replace(from, to));
  report.B.push(rel);
}

/* ---------- C：路由路径改写 ---------- */
const ROUTES = [];
for (const [pkg, pages] of Object.entries(PKG))
  for (const p of pages) ROUTES.push([`/pages/${p}/${p}`, `/` + pkg + `/pages/${p}/${p}`]);

const C_TARGETS = [
  ...walk(path.join(ROOT, 'pages'), ['.js', '.wxml'], []),
  ...walk(path.join(ROOT, 'pkgAi'), ['.js', '.wxml'], []),
  ...walk(path.join(ROOT, 'pkgGif'), ['.js', '.wxml'], []),
  ...walk(path.join(ROOT, 'pkgTools'), ['.js', '.wxml'], []),
  ...walk(path.join(ROOT, 'components'), ['.js', '.wxml'], []),
  path.join(ROOT, 'app.js'),
];
for (const f of C_TARGETS) {
  let src = fs.readFileSync(f, 'utf8');
  let n = 0;
  for (const [from, to] of ROUTES) {
    for (const q of ["'", '"']) {
      const pat = q + from, rep = q + to;
      while (src.includes(pat)) { src = src.replace(pat, rep); n++; }
    }
  }
  if (n) {
    fs.writeFileSync(f, src);
    report.C.push(`${path.relative(ROOT, f)}: ${n}`);
  }
}

/* ---------- sitemap.json ---------- */
const smPath = path.join(ROOT, 'sitemap.json');
let sm = fs.readFileSync(smPath, 'utf8');
let smN = 0;
for (const [from, to] of ROUTES) {
  const noSlash = from.slice(1); // pages/xxx/xxx（sitemap 无前导斜杠）
  const pat = '"' + noSlash + '"', rep = '"' + to.slice(1) + '"';
  while (sm.includes(pat)) { sm = sm.replace(pat, rep); smN++; }
}
fs.writeFileSync(smPath, sm);

/* ---------- 汇总 ---------- */
const aTotal = report.A.reduce((s, x) => s + parseInt(x.split(': ')[1]), 0);
const cTotal = report.C.reduce((s, x) => s + parseInt(x.split(': ')[1]), 0);
console.log(`A 页面 require 改写：${aTotal} 处（预期 56：pkgAi 36 + pkgGif 8 + pkgTools 12；aiColorize 含行尾注释的 upscale-local 曾被人工清单 grep -v "//" 滤掉，正则抓全）`);
report.A.forEach(x => console.log('  ' + x));
console.log(`B utils 内部定点修：${report.B.length}/4 文件`);
console.log(`C 路由路径改写：${cTotal} 处`);
report.C.forEach(x => console.log('  ' + x));
console.log(`sitemap.json：${smN} 处（预期 24）`);
if (aTotal !== 56) { console.error('!! A 总数与预期不符，检查上面明细'); process.exit(1); }
console.log('OK');
