// scripts/gif-report-test.js
// 报告引擎自测（零 npm 依赖，node 直接运行）。
// 覆盖：聚合/趋势/边界（空历史、单条、损坏记录容错）/LRU/摘要/对比/序列化。
//
// 运行：node scripts/gif-report-test.js

'use strict';

const path = require('path');
const report = require(path.join(__dirname, '..', 'utils', 'gif-report.js'));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (expected=' + b + ', actual=' + a + ')'); }
function approx(a, b, msg) { ok(Math.abs(a - b) < 0.001, msg + ' (expected≈' + b + ', actual=' + a + ')'); }

function makeRecord(overrides) {
  return Object.assign({
    id: 'r' + Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    tool: 'gifEditor',
    operations: ['crop', 'text'],
    sourceWidth: 480, sourceHeight: 360, sourceFrameCount: 20,
    sourceSize: 1000000,
    outputSize: 400000,
    outputWidth: 480, outputHeight: 360, outputFrameCount: 20,
    matchRate: 0.85,
    durationMs: 500,
    compressionStrategy: 'scale0.75-step2'
  }, overrides || {});
}

console.log('=== GIF Report Engine Tests ===\n');

// ---- 1. 空存储 ----
console.log('[1] 空存储聚合');
{
  const store = report.createStore();
  const agg = report.aggregate(store);
  eq(agg.totalExports, 0, 'empty: 0 exports');
  eq(agg.totalSavedBytes, 0, 'empty: 0 saved');
  eq(agg.averageCompressionRatio, 0, 'empty: ratio 0');
  eq(report.periodOverPeriod(store), null, 'empty: no PoP');
  ok(report.formatTrendSummary(store).indexOf('暂无') >= 0, 'empty: trend summary says no records');
}

// ---- 2. 单条记录 ----
console.log('[2] 单条记录');
{
  let store = report.createStore();
  const r = makeRecord({ sourceSize: 1000, outputSize: 250, matchRate: 0.9, durationMs: 100 });
  store = report.addRecord(store, r);
  eq(store.records.length, 1, '1 record added');
  const agg = report.aggregate(store);
  eq(agg.totalExports, 1, '1 export');
  eq(agg.totalSourceBytes, 1000, 'source 1000');
  eq(agg.totalOutputBytes, 250, 'output 250');
  eq(agg.totalSavedBytes, 750, 'saved 750');
  approx(agg.averageCompressionRatio, 0.25, 'ratio 0.25');
  approx(agg.averageMatchRate, 0.9, 'match 0.9');
  approx(agg.averageDurationMs, 100, 'duration 100');
  eq(agg.toolCounts.gifEditor, 1, 'tool count');
  eq(agg.strategyCounts['scale0.75-step2'], 1, 'strategy count');
  eq(report.periodOverPeriod(store), null, 'single record: no PoP');
}

// ---- 3. 多条记录聚合 ----
console.log('[3] 多条记录聚合');
{
  let store = report.createStore();
  store = report.addRecord(store, makeRecord({ sourceSize: 1000, outputSize: 500, matchRate: 0.8, durationMs: 200, tool: 'gifEditor' }));
  store = report.addRecord(store, makeRecord({ sourceSize: 2000, outputSize: 800, matchRate: 0.9, durationMs: 400, tool: 'gifBatch' }));
  store = report.addRecord(store, makeRecord({ sourceSize: 500, outputSize: 100, matchRate: 0.7, durationMs: 100, tool: 'gifEditor' }));
  const agg = report.aggregate(store);
  eq(agg.totalExports, 3, '3 exports');
  eq(agg.totalSourceBytes, 3500, 'total source 3500');
  eq(agg.totalOutputBytes, 1400, 'total output 1400');
  eq(agg.totalSavedBytes, 2100, 'total saved 2100');
  approx(agg.averageCompressionRatio, 1400 / 3500, 'avg ratio');
  approx(agg.averageMatchRate, (0.8 + 0.9 + 0.7) / 3, 'avg match');
  approx(agg.averageDurationMs, 700 / 3, 'avg duration');
  eq(agg.toolCounts.gifEditor, 2, 'gifEditor count 2');
  eq(agg.toolCounts.gifBatch, 1, 'gifBatch count 1');
}

// ---- 4. 环比变化 ----
console.log('[4] 环比变化');
{
  let store = report.createStore();
  const t0 = 1000000;
  store = report.addRecord(store, makeRecord({ timestamp: t0, sourceSize: 1000, outputSize: 500, matchRate: 0.8 }));
  store = report.addRecord(store, makeRecord({ timestamp: t0 + 1000, sourceSize: 1000, outputSize: 300, matchRate: 0.9 }));
  const pop = report.periodOverPeriod(store);
  ok(pop !== null, 'PoP exists');
  eq(pop.sizeDelta, -200, 'size delta -200');
  approx(pop.sizeDeltaPct, -0.4, 'size delta -40%');
  approx(pop.matchDelta, 0.1, 'match delta +0.1');
}

// ---- 5. 损坏记录容错 ----
console.log('[5] 损坏记录容错');
{
  let store = report.createStore();
  // 各种无效记录
  store = report.addRecord(store, null);
  store = report.addRecord(store, {});
  store = report.addRecord(store, { timestamp: 'invalid' });
  store = report.addRecord(store, { timestamp: Date.now(), sourceSize: 'abc', outputSize: 100 });
  store = report.addRecord(store, { timestamp: Date.now(), sourceSize: 100, outputSize: -5 });
  eq(store.records.length, 0, 'all invalid records rejected');

  // 有效 + 无效混合
  store = report.addRecord(store, makeRecord({ sourceSize: 1000, outputSize: 500 }));
  store = report.addRecord(store, null);
  store = report.addRecord(store, makeRecord({ sourceSize: 2000, outputSize: 1000 }));
  eq(store.records.length, 2, 'valid records kept, invalid rejected');
}

// ---- 6. 反序列化损坏数据 ----
console.log('[6] 反序列化容错');
{
  const s1 = report.deserialize(null);
  eq(s1.records.length, 0, 'null → empty');
  const s2 = report.deserialize('not json');
  eq(s2.records.length, 0, 'invalid json → empty');
  const s3 = report.deserialize(JSON.stringify({ foo: 'bar' }));
  eq(s3.records.length, 0, 'missing records array → empty');
  const s4 = report.deserialize(JSON.stringify({
    records: [
      makeRecord({ sourceSize: 100, outputSize: 50 }),
      null,
      { timestamp: 'bad' },
      makeRecord({ sourceSize: 200, outputSize: 100 })
    ]
  }));
  eq(s4.records.length, 2, 'valid records extracted from mixed');
}

// ---- 7. LRU 淘汰 ----
console.log('[7] LRU 淘汰');
{
  let store = report.createStore();
  const base = 1000000;
  for (let i = 0; i < 105; i++) {
    store = report.addRecord(store, makeRecord({
      timestamp: base + i * 1000,
      sourceSize: 1000 + i,
      outputSize: 500
    }));
  }
  eq(store.records.length, report.MAX_RECORDS, 'capped at MAX_RECORDS (' + report.MAX_RECORDS + ')');
  // 最旧的应被淘汰（timestamp 最小的）
  const minTs = Math.min.apply(null, store.records.map(r => r.timestamp));
  ok(minTs > base, 'oldest record evicted');
}

// ---- 8. 文字摘要 ----
console.log('[8] 文字摘要');
{
  const r = makeRecord({
    timestamp: new Date('2026-09-07T12:00:00').getTime(),
    sourceSize: 2048000, outputSize: 512000,
    sourceWidth: 640, sourceHeight: 480, sourceFrameCount: 30,
    outputWidth: 480, outputHeight: 360, outputFrameCount: 20,
    matchRate: 0.92, durationMs: 1200,
    compressionStrategy: 'scale0.75-step2',
    operations: ['crop:1:1', 'text', 'erase', 'speed:2x']
  });
  const summary = report.formatRecordSummary(r);
  ok(summary.indexOf('GIF 导出报告') >= 0, 'has title');
  ok(summary.indexOf('640×480') >= 0, 'has source dimensions');
  ok(summary.indexOf('1.95 MB') >= 0, 'has source size (' + summary.match(/源[^\n]*/)?.[0] + ')');
  ok(summary.indexOf('500.0 KB') >= 0, 'has output size');
  ok(summary.indexOf('25.0%') >= 0, 'has compression ratio');
  ok(summary.indexOf('92.0%') >= 0, 'has match rate');
  ok(summary.indexOf('scale0.75-step2') >= 0, 'has strategy');
  ok(summary.indexOf('crop:1:1') >= 0, 'has operations');
  ok(summary.indexOf('1200ms') >= 0, 'has duration');
}

// ---- 9. 对比报告 ----
console.log('[9] 对比报告');
{
  const a = makeRecord({ outputSize: 1000000, sourceSize: 2000000, matchRate: 0.7, outputWidth: 640, outputHeight: 480, outputFrameCount: 30, compressionStrategy: 'original' });
  const b = makeRecord({ outputSize: 300000, sourceSize: 2000000, matchRate: 0.9, outputWidth: 320, outputHeight: 240, outputFrameCount: 15, compressionStrategy: 'scale0.5-step2' });
  const cmp = report.formatComparison(a, b);
  ok(cmp.indexOf('导出对比') >= 0, 'has title');
  ok(cmp.indexOf('→') >= 0, 'has arrow');
  ok(cmp.indexOf('scale0.5-step2') >= 0, 'has strategy');
}

// ---- 10. 序列化/反序列化往返 ----
console.log('[10] 序列化往返');
{
  let store = report.createStore();
  store = report.addRecord(store, makeRecord({ sourceSize: 1000, outputSize: 500 }));
  store = report.addRecord(store, makeRecord({ sourceSize: 2000, outputSize: 800 }));
  const str = report.serialize(store);
  const restored = report.deserialize(str);
  eq(restored.records.length, 2, '2 records after round-trip');
  approx(restored.records[0].sourceSize, 1000, 'record 0 source preserved');
  approx(restored.records[1].outputSize, 800, 'record 1 output preserved');
}

// ---- 11. 趋势摘要 ----
console.log('[11] 趋势摘要');
{
  let store = report.createStore();
  store = report.addRecord(store, makeRecord({ sourceSize: 1000000, outputSize: 400000, matchRate: 0.85, durationMs: 500 }));
  const summary = report.formatTrendSummary(store);
  ok(summary.indexOf('1 次') >= 0, 'shows export count');
  ok(summary.indexOf('累计节省') >= 0, 'shows savings');
  ok(summary.indexOf('平均压缩比') >= 0, 'shows avg ratio');
}

// ---- 12. 字段容错（旧字段名） ----
console.log('[12] 旧字段名兼容');
{
  // 模拟旧版可能使用 inputSize/encodedSize
  const old = {
    id: 'old1', timestamp: Date.now(), tool: 'gifEditor',
    inputSize: 1000, encodedSize: 300,
    operations: [], sourceWidth: 0, sourceHeight: 0, sourceFrameCount: 0,
    outputWidth: 0, outputHeight: 0, outputFrameCount: 0,
    matchRate: 0, durationMs: 0, compressionStrategy: 'none'
  };
  let store = report.createStore();
  store = report.addRecord(store, old);
  eq(store.records.length, 1, 'old field names accepted');
  eq(store.records[0].sourceSize, 1000, 'inputSize mapped to sourceSize');
  eq(store.records[0].outputSize, 300, 'encodedSize mapped to outputSize');
}

// ---- Results ----
console.log('\n=== Results ===');
console.log('PASS: ' + pass);
console.log('FAIL: ' + fail);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
  process.exit(1);
} else {
  console.log('\n✓ All report engine tests passed.');
}
