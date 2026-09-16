# tune-coldstart-subpackage-20260915

- 类型：tune
- 创建：2026-09-15（北京）
- 状态：进行中

## 阶段进度
| 阶段 | 状态 | 评审轮次 | 产出物 |
|---|---|---|---|
| 1 需求分析 | ✅ | - | request_analysis/spec.md, tasks.md |
| 3 编码实现 | ✅ | - | coding/coding_report_v1.md（含验证证据 + 迁移/验证脚本工件） |
| 4 编码评审 | ⏳ | - | - |
| 5 验证用例设计 | - | - | - |
| 6 验证用例评审 | - | - | - |
| 7 构建部署 | - | - | - |
| 8 预览验证 | - | - | - |
| 9 部署验证 | - | - | - |
| 10 用户确认 | - | - | - |

## 验证用例数
待阶段5

## 关键决议
- HITL①（2026-09-15）：方案 A+B 都做（分包治本 + 用户后台数据核实）；分包粒度取激进方案（主包只留 index+8 高频页）。
- HITL②（2026-09-15）：spec 经 3 轮评审 APPROVED，待用户批准进编码。
- HITL③④⑤：-

## 评审轮次记录
- v1（❌）：Critical×1——gif-encoder(→pkgGif) 懒加载 `./color-quantize` 与 color-quantize(→pkgTools) 跨分包非法，改为 color-quantize 留主包；Important×2——被迁 utils 自身内部 require 修正缺失、T5 残留 grep 必然假阳性；Minor×5。
- v2（❌）：N-1 Critical——修 v1 时把 utils 文件指向主包的层数错写成三层（应为两层，v1 引入）；N-2/N-3/M-7 Minor。
- v3（APPROVED）：4/4 已修，0 新问题。

## 背景速记
- 诊断：冷启动 1439.5ms vs 基准 360ms（+299.9%）；根因最可能为推广期首装占比上升 + 主包 1.65MB 无分包。
- 已确认死代码：pages/aiEnhance（17K，2026-03 遗留未注册）、images/placeholder.png（35K 无引用）。
- 用户并行行动项（方案 B）：后台核实版本发布记录 / 启动漏斗分位数 / 新用户占比。

## 产出物索引
- request_analysis/spec.md
- request_analysis/tasks.md

## 教训沉淀
- （分析期）grep require 需同时查带 `.js` 后缀与不带两种形式，否则漏报（piexif.js 曾被误判为死代码）。
