#!/usr/bin/env node
/**
 * 分包迁移验证脚本（T6 证据生成）
 * 1. JSON 合法性：app.json / sitemap.json / 全部页面 .json
 * 2. 注册↔磁盘一致：app.json 每个注册页四件套齐全；磁盘页面目录无未注册孤儿
 * 3. require 解析：pages/ pkgX/ utils/ components/ app.js 的全部相对 require 目标文件必须存在
 * 4. 路由清扫：字符串字面量里的 '/pages/xxx' 只允许出现 9 个主包页
 * 5. preloadRule：入口页在主包、目标分包已注册
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const fail = [];
const ok = [];

function walk(dir, exts, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (exts.some(x => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

/* 1. JSON 合法性 */
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const sitemap = JSON.parse(fs.readFileSync(path.join(ROOT, 'sitemap.json'), 'utf8'));
let jsonN = 1;
for (const f of [...walk(path.join(ROOT, 'pages'), ['.json'], []),
...walk(path.join(ROOT, 'pkgAi'), ['.json'], []),
...walk(path.join(ROOT, 'pkgGif'), ['.json'], []),
...walk(path.join(ROOT, 'pkgTools'), ['.json'], []),
path.join(ROOT, 'sitemap.json')]) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); jsonN++; } catch (e) { fail.push(`JSON 解析失败: ${f}: ${e.message}`); }
}
ok.push(`JSON 合法: ${jsonN} 个文件`);

/* 2. 注册↔磁盘一致 */
const MAIN_PAGES = app.pages;                                   // 9
const SUB = app.subpackages;                                    // 3
const REG = new Set(MAIN_PAGES);
for (const s of SUB) for (const p of s.pages) REG.add(`${s.root}/${p}`);
for (const page of REG) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!fs.existsSync(path.join(ROOT, page + ext))) fail.push(`注册页缺文件: ${page}${ext}`);
  }
}
const orphanDirs = [];
for (const base of ['pages', 'pkgAi/pages', 'pkgGif/pages', 'pkgTools/pages']) {
  for (const d of fs.readdirSync(path.join(ROOT, base), { withFileTypes: true })) {
    if (d.isDirectory()) {
      const rel = `${base}/${d.name}/${d.name}`;
      if (!REG.has(rel)) orphanDirs.push(rel);
    }
  }
}
if (orphanDirs.length) fail.push(`磁盘孤儿页面目录: ${orphanDirs.join(', ')}`);
ok.push(`注册页 ${REG.size} 个（主包 ${MAIN_PAGES.length} + 分包 ${REG.size - MAIN_PAGES.length}）四件套齐全，磁盘无孤儿`);

/* 3. require 解析 */
let reqN = 0, reqBad = 0;
const CODE = [
  ...walk(path.join(ROOT, 'pages'), ['.js'], []),
  ...walk(path.join(ROOT, 'pkgAi'), ['.js'], []),
  ...walk(path.join(ROOT, 'pkgGif'), ['.js'], []),
  ...walk(path.join(ROOT, 'pkgTools'), ['.js'], []),
  ...walk(path.join(ROOT, 'utils'), ['.js'], []),
  ...walk(path.join(ROOT, 'components'), ['.js'], []),
  path.join(ROOT, 'app.js'),
];
const REQ_RE = /require\((['"])(\.[^'"]+)\1\)/g;
for (const f of CODE) {
  const src = fs.readFileSync(f, 'utf8')
    .split('\n').filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); }).join('\n'); // 剥注释行（JSDoc 用法示例会被误报）
  let m;
  while ((m = REQ_RE.exec(src))) {
    const spec = m[2];
    if (!spec.endsWith('.js') && !/\.json$/.test(spec)) {
      // 无后缀模块：按 CommonJS 规则尝试 spec、spec.js
    }
    const base = path.resolve(path.dirname(f), spec);
    const exists = fs.existsSync(base) || fs.existsSync(base + '.js');
    reqN++;
    if (!exists) { reqBad++; fail.push(`require 无法解析: ${path.relative(ROOT, f)} -> ${spec}`); }
  }
}
ok.push(`require 解析: ${reqN} 条${reqBad ? '，失败 ' + reqBad : '，全部通过'}`);

/* 4. 路由清扫：'/pages/xxx 只允许主包 9 页 */
const MAIN_SET = new Set(MAIN_PAGES);
let routeHits = 0, routeBad = 0;
const ROUTE_FILES = CODE.flatMap(f => [f, f.replace(/\.js$/, '.wxml')]).filter(f => f.endsWith('.wxml') || f.endsWith('.js'))
  .concat(walk(path.join(ROOT, 'pages'), ['.wxml'], []));
const seen = new Set();
for (const f of ROUTE_FILES) {
  if (seen.has(f) || !fs.existsSync(f)) continue;
  seen.add(f);
  const src = fs.readFileSync(f, 'utf8');
  let m;
  const R = /(['"])\/pages\/([A-Za-z0-9_]+)\/\2/g;
  while ((m = R.exec(src))) {
    routeHits++;
    if (!MAIN_SET.has(`pages/${m[2]}/${m[2]}`)) { routeBad++; fail.push(`旧路径残留: ${path.relative(ROOT, f)} -> ${m[0]}`); }
  }
}
ok.push(`路由字面量 '/pages/x/x': ${routeHits} 处，非主包残留 ${routeBad}`);

/* sitemap 页面均在注册集内 */
let smBad = 0;
for (const r of sitemap.rules) {
  if (!REG.has(r.page)) { smBad++; fail.push(`sitemap 含未注册页: ${r.page}`); }
}
ok.push(`sitemap: ${sitemap.rules.length} 条规则，未注册 ${smBad}`);

/* 5. preloadRule */
const pr = app.preloadRule && app.preloadRule['pages/index/index'];
if (!pr || !pr.packages.every(p => SUB.some(s => s.root === p))) fail.push('preloadRule 配置异常');
else ok.push(`preloadRule: index -> ${pr.packages.join(',')} (network=${pr.network})`);

/* 汇总 */
console.log('===== 验证结果 =====');
ok.forEach(x => console.log('✅ ' + x));
if (fail.length) {
  console.log(`\n❌ 失败 ${fail.length} 项:`);
  fail.forEach(x => console.log('  - ' + x));
  process.exit(1);
}
console.log('\nALL PASS');
