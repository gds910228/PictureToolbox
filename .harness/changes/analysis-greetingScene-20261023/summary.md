# analysis-greetingScene-20261023 — 问候场景切入·数据验证口径

- 类型：analysis（决策依据分析；不属于 feat/fix/tune，为后续 `feat-greeting*` 的阶段 0 产出，特此说明命名偏差）
- 创建：2026-10-23（北京）
- 状态：已完成（分析口径落定；待执行后台/数据库取数）
- 决策问题：现有用户中是否已存在"问候/表达"画像苗头，值得投入问候场景 MVP？

---

## 1. 数据源盘点（已核实，2026-10-23）

| # | 数据源 | 内容 | 位置 | 数据起点 | 局限 |
|---|---|---|---|---|---|
| S1 | 公众平台官方统计 | DAU/新增/留存、用户画像（年龄段）、分享次数/人数、场景值分布 | mp.weixin.qq.com → 统计 | 上线起 | 画像需样本量；无 openid 级明细 |
| S2 | 自定义事件埋点 | `tool_view`(32页) / `tool_complete`(36处) / `share_click`(30页, 带 friend/timeline) / `enter_source` / `hot_scene_click` / `gif_*`；每事件自带 scene 码 | 统计 → 自定义分析 | **2026-07-18**（analytics.js 上线 commit；实际起点=后台事件登记日，需先确认） | 事件未在后台登记则历史数据为空；openid 级不可得 |
| S3 | `rate_limit` 集合 | 8 功能每用户每日 `{openid, feature, date, count, updatedAt}`：`matting/caption/avatar/describe/style/outpaint/text2img/pdftoimage` | 云开发控制台 → 数据库 | 各功能上线日（多数 2026-07-03+） | **仅此 8 功能**——aiUpscale/aiColorize/aiEraser/aiOCR/aiChat/imgToPdf/makeGif 无限流记录（尤其 aiColorize 老照片上色，最戳长辈却无 openid 级数据）；限流降级放行时漏计；updatedAt=当日最后一次使用时刻 |
| S4 | 盲区 | 基础工具 openid 级明细、模板/问候专项、分享卡落地归因 | — | — | MVP 前埋点清单见 §5 |

关键既有能力：S2 的 `enter_source`/scene 码已具备**群聊分享来源归因**（1007 单聊 / 1008 群聊），无需新增开发。

## 2. 假设 → 指标 → 判读

| # | 假设 | 指标口径 | 数据源 | 判读 |
|---|---|---|---|---|
| H1 | 长辈画像已存在 | 用户画像中 46-60 + 60 以上占比 | S1 | <8% 弱信号；8-15% 形态转"全龄祝福卡"；**≥15% 长辈友好流程值得做** |
| H2 | "表达型"功能已活跃且偏好明确 | 表达组（caption/avatar/text2img/style）tool_complete 占比；完成率=complete/view 分组对比 | S2 | 表达组占比显著高于其入口数量占比 → 有表达需求苗头 |
| H3 | 存在仪式性（节假日）抬升 | 按日 share_click 次数与 tool_complete：2026-09-25（中秋）/10-01~07（国庆） vs 前后各一周均值 | S2 | 抬升 ≥20% 为信号。**混杂项：9/06 gifEditor/gifBatch 上线、9/19 GIF 导入改版，需剔除 gif_* 事件单独看** |
| H4 | 传播现状基线 | 分享人数/DAU；share_click 人均次数、channel 占比；场景分布 1007/1008 进入占比 | S1+S2 | 本身非门槛，作为 MVP 后对比基线记录 |
| H5 | 存在粘度种子用户 | openid 月活跃天数分布（活跃≥5 天/月 占比）；种子用户的功能构成是否偏表达组 | S3 | ≥10% 且偏表达组 → MVP 冷启动有种子可推 |
| H6 | 使用时段有"早晚仪式感" | updatedAt 的北京时间小时分布（5-9 点占比） | S3 | 偏差提示：updatedAt 为当日最后一次使用，人群级早晚型仍可判 |

## 3. 执行清单（零代码）

**Step 1 后台三处（S1，先看，半小时内可完成）**
1. 统计 → 用户画像 → 年龄分布：记 46+/60+ 占比（H1 主门槛）
2. 统计 → 访问趋势：导出 2026-07 至今日曲线，标 9/25、10/01-07（H3，S2 前后对照）
3. 统计 → 自定义分析：先确认 `tool_view/tool_complete/share_click/enter_source` **已登记且能查到数据**；登记日=数据起点。再查 H2/H3/H4 口径（tool_complete 按 toolId 分组；share_click 按 channel 分组；按日趋势）

**Step 2 rate_limit 取数（S3）**
首选：云开发控制台 → 数据库 → `rate_limit` → **导出 CSV/JSON 全量**，交给 AI 本地算 §2 全部 openid 级口径（H5/H6）。
备选：控制台高级查询直接跑聚合管道（见 §4）。

**Step 3 汇总判读**：把 H1-H6 结果填入 §6 决策表，落"做/转形态/不做"结论回本文件。

## 4. rate_limit 聚合管道（备选，可直接粘贴）

a) 每日可观测活跃用户与用量：
```json
[{"$group":{"_id":{"date":"$date"},"users":{"$addToSet":"$openid"},"uses":{"$sum":"$count"}}},
 {"$project":{"date":"$_id.date","users":{"$size":"$users"},"uses":1,"_id":0}},
 {"$sort":{"date":1}}]
```

b) 每功能每日用量：
```json
[{"$group":{"_id":{"feature":"$feature","date":"$date"},"users":{"$addToSet":"$openid"},"uses":{"$sum":"$count"}}},
 {"$project":{"feature":"$_id.feature","date":"$_id.date","users":{"$size":"$users"},"uses":1,"_id":0}},
 {"$sort":{"date":1,"feature":1}}]
```

c) openid 月活跃天数分布（近 30 天，改日期即换窗口）：
```json
[{"$match":{"date":{"$gte":"2026-09-23"}}},
 {"$group":{"_id":"$openid","days":{"$addToSet":"$date"}}},
 {"$project":{"n":{"$size":"$days"},"_id":0}},
 {"$group":{"_id":"$n","users":{"$sum":1}}},
 {"$sort":{"_id":1}}]
```

d) 表达组 vs 工具组占比：
```json
[{"$project":{"openid":1,"feature":1,"count":1,
   "grp":{"$cond":[{"$in":["$feature",["caption","avatar","text2img","style"]]},"expr","util"]}}},
 {"$group":{"_id":"$grp","uses":{"$sum":"$count"},"users":{"$addToSet":"$openid"}}},
 {"$project":{"uses":1,"users":{"$size":"$users"},"_id":0}}]
```

e) 时段分布（北京时间小时；updatedAt=当日最后使用时刻）：
```json
[{"$project":{"h":{"$hour":{"$add":["$updatedAt",28800000]}}}},
 {"$group":{"_id":"$h","docs":{"$sum":1}}},
 {"$sort":{"_id":1}}]
```

## 5. 数据缺口 → MVP 前埋点清单（本次不实施）

1. `compare` 页补接 analytics（当前 32/33，唯一漏网页面）
2. 问候专项事件：`greeting_view / greeting_complete / greeting_save / greeting_share / greeting_landing`
3. 分享归因：`onShareAppMessage` path 携带 `src=greeting&tpl=<id>`，落地页 onLoad 解析后 `track('greeting_landing')`（scene 码已有，路径参数补齐闭环）
4. 合规边界：仅上报功能统计与 scene/参数，**不上报图片内容与文本内容**（沿用工具类目最小收集口径）
5. 可选（成本收益存疑）：基础工具 openid 级明细——自定义事件已有量级，暂不做

## 6. 决策门汇总（取数后填写）

| 门 | 看什么 | 结果 | 结论分支 |
|---|---|---|---|
| G1 画像 | 46+ 占比 | ___ | ≥15% 做长辈友好流程；8-15% 转全龄祝福卡；<8% 不做问候场景，另寻粘度抓手 |
| G2 仪式性 | 节假日抬升 | ___ | ≥20% → 日历驱动内容设计成立 |
| G3 传播基线 | 分享人数/DAU、1007/1008 占比 | ___ | 记录为 MVP 对比基线 |
| G4 种子 | 月活跃≥5天占比、功能构成 | ___ | ≥10% 且偏表达组 → 冷启动种子池 |

综合结论：___（做/转形态/不做，一句话理由）

## 产出物索引

- 本文件为唯一 SoT；取数结果与判读更新至 §2/§6。
- 后续 `feat-greeting-*` 变更目录创建时，在此文件追加链接。
- 2026-10-23：用户决议跳过取数直接实施 MVP → `.harness/changes/feat-greetingMvp-20261023/summary.md`（§5 埋点清单第 1、3 项已随该需求落地：compare 补埋点、greeting 专项事件与分享归因）。
