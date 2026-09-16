// utils/gif-report.js
// GIF 导出优化报告引擎：聚合导出记录、计算趋势、生成文字摘要。
// 纯函数 + 可选持久化注入，无 wx 硬依赖，可 node 直接测试。
//
// 记录结构：
// {
//   id: string,
//   timestamp: number,        // Date.now()
//   tool: string,             // 'gifEditor' | 'gifBatch'
//   operations: string[],     // 操作列表，如 ['crop', 'text', 'erase', 'speed:2x']
//   sourceWidth, sourceHeight, sourceFrameCount,
//   sourceSize: number,       // 源文件字节数
//   outputSize: number,       // 输出字节数
//   outputWidth, outputHeight, outputFrameCount,
//   matchRate: number,        // 0-1，±8 容差像素匹配率（可选）
//   durationMs: number,       // 编码耗时
//   compressionStrategy: string  // 命中的压缩策略
// }

'use strict';

var MAX_RECORDS = 100; // LRU 容量

/**
 * 创建空的报告存储
 */
function createStore() {
  return { records: [], version: 1 };
}

/**
 * 校验并规范化一条记录（容错：损坏/缺字段记录跳过）
 * @param {any} raw
 * @returns {object|null}
 */
function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.timestamp !== 'number' || !isFinite(raw.timestamp) || raw.timestamp <= 0) return null;
  var ss = sourceSize(raw), os = outputSize(raw);
  if (typeof ss !== 'number' || !isFinite(ss) || ss < 0) return null;
  if (typeof os !== 'number' || !isFinite(os) || os < 0) return null;
  return {
    id: String(raw.id || raw.timestamp + '_' + Math.random().toString(36).slice(2, 6)),
    timestamp: raw.timestamp,
    tool: String(raw.tool || 'unknown'),
    operations: Array.isArray(raw.operations) ? raw.operations.filter(function (s) { return typeof s === 'string'; }) : [],
    sourceWidth: numOr(raw.sourceWidth, 0),
    sourceHeight: numOr(raw.sourceHeight, 0),
    sourceFrameCount: numOr(raw.sourceFrameCount, 0),
    sourceSize: sourceSize(raw),
    outputSize: outputSize(raw),
    outputWidth: numOr(raw.outputWidth, 0),
    outputHeight: numOr(raw.outputHeight, 0),
    outputFrameCount: numOr(raw.outputFrameCount, 0),
    matchRate: numOr(raw.matchRate, 0),
    durationMs: numOr(raw.durationMs, 0),
    compressionStrategy: String(raw.compressionStrategy || 'none')
  };
}

function sourceSize(r) { return typeof r.sourceSize === 'number' ? r.sourceSize : (typeof r.inputSize === 'number' ? r.inputSize : NaN); }
function outputSize(r) { return typeof r.outputSize === 'number' ? r.outputSize : (typeof r.encodedSize === 'number' ? r.encodedSize : NaN); }
function numOr(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

/**
 * 添加一条导出记录。
 * 自动 LRU 淘汰（超过 MAX_RECORDS 删除最旧）。
 * @param {object} store
 * @param {object} record
 * @returns {object} 更新后的 store（不可变风格，但也 in-place 兼容）
 */
function addRecord(store, record) {
  var normalized = normalizeRecord(record);
  if (!normalized) return store;
  var records = store.records.slice();
  records.push(normalized);
  // LRU：按时间排序，超出容量删最旧
  records.sort(function (a, b) { return a.timestamp - b.timestamp; });
  while (records.length > MAX_RECORDS) records.shift();
  return { records: records, version: store.version || 1 };
}

/**
 * 计算聚合指标。
 * @param {object} store
 * @returns {object}
 */
function aggregate(store) {
  var records = store.records || [];
  if (records.length === 0) {
    return {
      totalExports: 0,
      totalSourceBytes: 0,
      totalOutputBytes: 0,
      totalSavedBytes: 0,
      averageCompressionRatio: 0,
      averageMatchRate: 0,
      averageDurationMs: 0,
      toolCounts: {},
      strategyCounts: {},
      firstExport: null,
      lastExport: null
    };
  }

  var totalSource = 0, totalOutput = 0, totalDuration = 0, totalMatch = 0, matchCount = 0;
  var toolCounts = {};
  var strategyCounts = {};
  var minTs = Infinity, maxTs = 0;

  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    totalSource += r.sourceSize;
    totalOutput += r.outputSize;
    totalDuration += r.durationMs;
    if (r.matchRate > 0) { totalMatch += r.matchRate; matchCount++; }
    toolCounts[r.tool] = (toolCounts[r.tool] || 0) + 1;
    strategyCounts[r.compressionStrategy] = (strategyCounts[r.compressionStrategy] || 0) + 1;
    if (r.timestamp < minTs) minTs = r.timestamp;
    if (r.timestamp > maxTs) maxTs = r.timestamp;
  }

  return {
    totalExports: records.length,
    totalSourceBytes: totalSource,
    totalOutputBytes: totalOutput,
    totalSavedBytes: Math.max(0, totalSource - totalOutput),
    averageCompressionRatio: totalSource > 0 ? totalOutput / totalSource : 1,
    averageMatchRate: matchCount > 0 ? totalMatch / matchCount : 0,
    averageDurationMs: records.length > 0 ? totalDuration / records.length : 0,
    toolCounts: toolCounts,
    strategyCounts: strategyCounts,
    firstExport: minTs === Infinity ? null : minTs,
    lastExport: maxTs
  };
}

/**
 * 计算环比变化（最近一次 vs 上一次）。
 * @param {object} store
 * @returns {object|null} { sizeDelta, ratioDelta, matchDelta }
 */
function periodOverPeriod(store) {
  var records = store.records || [];
  if (records.length < 2) return null;
  var sorted = records.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
  var prev = sorted[sorted.length - 2];
  var curr = sorted[sorted.length - 1];
  return {
    sizeDelta: curr.outputSize - prev.outputSize,
    sizeDeltaPct: prev.outputSize > 0 ? (curr.outputSize - prev.outputSize) / prev.outputSize : 0,
    ratioDelta: (prev.sourceSize > 0 ? curr.outputSize / curr.sourceSize : 1) -
                (prev.sourceSize > 0 ? prev.outputSize / prev.sourceSize : 1),
    matchDelta: curr.matchRate - prev.matchRate
  };
}

/**
 * 生成单次报告的文字摘要（可一键复制）。
 * @param {object} record
 * @returns {string}
 */
function formatRecordSummary(record) {
  var lines = [];
  lines.push('【GIF 导出报告】');
  lines.push('时间: ' + new Date(record.timestamp).toLocaleString());
  lines.push('工具: ' + record.tool);
  if (record.operations.length > 0) {
    lines.push('操作: ' + record.operations.join(', '));
  }
  if (record.sourceWidth > 0) {
    lines.push('源: ' + record.sourceWidth + '×' + record.sourceHeight +
      ' · ' + record.sourceFrameCount + '帧 · ' + formatBytes(record.sourceSize));
  } else {
    lines.push('源大小: ' + formatBytes(record.sourceSize));
  }
  if (record.outputWidth > 0) {
    lines.push('输出: ' + record.outputWidth + '×' + record.outputHeight +
      ' · ' + record.outputFrameCount + '帧 · ' + formatBytes(record.outputSize));
  } else {
    lines.push('输出大小: ' + formatBytes(record.outputSize));
  }
  if (record.sourceSize > 0) {
    var ratio = (record.outputSize / record.sourceSize * 100).toFixed(1);
    var saved = Math.max(0, record.sourceSize - record.outputSize);
    lines.push('压缩比: ' + ratio + '%（节省 ' + formatBytes(saved) + '）');
  }
  if (record.matchRate > 0) {
    lines.push('画质匹配: ' + (record.matchRate * 100).toFixed(1) + '%（±8 容差）');
  }
  if (record.durationMs > 0) {
    lines.push('耗时: ' + record.durationMs + 'ms');
  }
  if (record.compressionStrategy && record.compressionStrategy !== 'none') {
    lines.push('压缩策略: ' + record.compressionStrategy);
  }
  return lines.join('\n');
}

/**
 * 生成两条记录的对比报告。
 * @param {object} a
 * @param {object} b
 * @returns {string}
 */
function formatComparison(a, b) {
  var lines = [];
  lines.push('【导出对比】');
  lines.push('A: ' + new Date(a.timestamp).toLocaleString() + ' (' + a.tool + ')');
  lines.push('B: ' + new Date(b.timestamp).toLocaleString() + ' (' + b.tool + ')');
  lines.push('');
  lines.push('体积: ' + formatBytes(a.outputSize) + ' → ' + formatBytes(b.outputSize) +
    ' (' + signedPct(b.outputSize - a.outputSize, a.outputSize) + ')');
  if (a.sourceSize > 0 && b.sourceSize > 0) {
    var ra = a.outputSize / a.sourceSize;
    var rb = b.outputSize / b.sourceSize;
    lines.push('压缩比: ' + (ra * 100).toFixed(1) + '% → ' + (rb * 100).toFixed(1) + '%');
  }
  if (a.matchRate > 0 || b.matchRate > 0) {
    lines.push('画质: ' + (a.matchRate * 100).toFixed(1) + '% → ' + (b.matchRate * 100).toFixed(1) + '%');
  }
  if (a.outputWidth > 0 && b.outputWidth > 0) {
    lines.push('尺寸: ' + a.outputWidth + '×' + a.outputHeight + ' → ' + b.outputWidth + '×' + b.outputHeight);
  }
  if (a.outputFrameCount > 0 && b.outputFrameCount > 0) {
    lines.push('帧数: ' + a.outputFrameCount + ' → ' + b.outputFrameCount);
  }
  lines.push('策略: ' + (a.compressionStrategy || 'none') + ' → ' + (b.compressionStrategy || 'none'));
  return lines.join('\n');
}

/**
 * 生成历史趋势摘要（用于报告页概览）。
 * @param {object} store
 * @returns {string}
 */
function formatTrendSummary(store) {
  var agg = aggregate(store);
  if (agg.totalExports === 0) return '暂无导出记录';
  var lines = [];
  lines.push('【导出趋势】');
  lines.push('总导出: ' + agg.totalExports + ' 次');
  lines.push('累计节省: ' + formatBytes(agg.totalSavedBytes));
  lines.push('平均压缩比: ' + (agg.averageCompressionRatio * 100).toFixed(1) + '%');
  if (agg.averageMatchRate > 0) {
    lines.push('平均画质匹配: ' + (agg.averageMatchRate * 100).toFixed(1) + '%');
  }
  lines.push('平均耗时: ' + Math.round(agg.averageDurationMs) + 'ms');
  var pop = periodOverPeriod(store);
  if (pop) {
    lines.push('环比: 体积 ' + signedPct(pop.sizeDelta, 0).replace(/^\+?(-?[\d.]+%)$/, '$1'));
  }
  return lines.join('\n');
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function signedPct(delta, base) {
  if (base === 0) return '—';
  var pct = (delta / base * 100);
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

/**
 * 序列化 store 到 JSON 字符串（用于 wx.setStorageSync）。
 * 容错：损坏数据返回空 store。
 */
function serialize(store) {
  try {
    return JSON.stringify({ v: 1, records: store.records });
  } catch (e) {
    return JSON.stringify({ v: 1, records: [] });
  }
}

/**
 * 从 JSON 字符串反序列化（容错：损坏/旧版返回空 store）。
 */
function deserialize(str) {
  if (!str || typeof str !== 'string') return createStore();
  try {
    var data = JSON.parse(str);
    if (!data || !Array.isArray(data.records)) return createStore();
    var valid = [];
    for (var i = 0; i < data.records.length; i++) {
      var r = normalizeRecord(data.records[i]);
      if (r) valid.push(r);
    }
    return { records: valid, version: 1 };
  } catch (e) {
    return createStore();
  }
}

module.exports = {
  MAX_RECORDS: MAX_RECORDS,
  createStore: createStore,
  normalizeRecord: normalizeRecord,
  addRecord: addRecord,
  aggregate: aggregate,
  periodOverPeriod: periodOverPeriod,
  formatRecordSummary: formatRecordSummary,
  formatComparison: formatComparison,
  formatTrendSummary: formatTrendSummary,
  formatBytes: formatBytes,
  serialize: serialize,
  deserialize: deserialize
};
