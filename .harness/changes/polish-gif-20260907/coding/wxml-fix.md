# WXML 编译修复

- 日期：2026-09-07
- 问题：pages/gifReport/gifReport.wxml 第 21 行报 `Bad value with message: unexpected token .`

## 根因

WXML 模板表达式不支持 JavaScript 方法调用（如 `.toFixed()`、`.indexOf()`）。
gifReport.wxml 中直接在 `{{}}` 内使用了：
- `(agg.totalSavedBytes/1048576).toFixed(2)`
- `(agg.averageCompressionRatio*100).toFixed(1)`
- `compareIds.indexOf(item.id) >= 0`
- `(item.outputSize/item.sourceSize*100).toFixed(0)`

微信小程序 WXML 表达式仅支持：基本运算、三元、逻辑、比较、简单属性访问。
不支持：方法调用、函数调用、`?.`、`??` 等。

## 修复

在 `gifReport.js` 的 `_loadRecords()` 中预计算所有显示值：
- `agg.totalSavedText` → 格式化后的体积字符串
- `agg.avgRatioText` → 压缩比百分比
- `agg.avgMatchText` → 画质百分比
- 每条记录的 `outputSizeText`、`ratioText`、`timeText`、`isComparing`

WXML 改为直接引用预计算字段，无方法调用。

## 验证

- 9 个 JS 文件 `node -c` 语法检查通过
- 4 个 GIF 相关 WXML 文件 grep 确认无 `.toFixed(` / `.indexOf(` 等方法调用
- 全部自动化测试通过（2918 断言/迭代，0 失败）
