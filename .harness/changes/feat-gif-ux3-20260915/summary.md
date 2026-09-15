# feat-gif-ux3-20260915

- 类型：feat
- 创建：2026-09-15（北京）
- 状态：进行中

## 背景

真机使用 GIF 编辑器套件后用户提出三条反馈，一次变更解决：

1. **擦除只能逐帧执行**——擦水印场景要逐帧重复涂抹，需「当前帧 / 全部帧」作用域开关。
2. **压缩目标体积只有 MB**——小体积场景（表情/聊天）需要 KB 粒度。
3. **导出报告 / 草稿管理入口找不到**——fix-gif-polish-20260914 撤掉首页入口后，唯一入口藏在「导出结果」卡片（`wx:if="{{resultPath}}"`），必须导出成功才可见。

**顺带修复的存量 bug**：擦除撤销是空操作——旧 `_pushEraseUndo` 在 touchend 压入**擦除后**整帧快照，`undoErase` pop 回同状态，无任何视觉效果。根因：快照应在 touchstart（擦除前）采集。fix-gif-polish-20260914 的 5 项修复不含此项。

## 方案要点

| # | 改动 | 文件 |
|---|---|---|
| 1 | 擦除作用域 `eraseScope: 'current'/'all'` chip 开关（仿文字工具作用帧模式）；`_eraseAtPoint` 全帧路径笔画记 `frame:-1`（草稿重放展开到全部帧） | pages/gifEditor/gifEditor.js + .wxml |
| 2 | 撤销机制重构：整帧快照 → **笔画包围盒区域快照**（复用既有 `snapshotRect`/`restoreRect`，gif-frame-ops.js:92-116，feat-gifeditor-adv 已建未用）；touchstart 采集受影响帧擦除前副本（`_strokeBase`，瞬态）、touchend 按 bbox 并集转区域 entry 入栈；entry 带 `strokeId`，全部帧笔画 undo/redo 跨帧联动（其他帧栈中可 splice 中间位置） | pages/gifEditor/gifEditor.js |
| 3 | KB/MB 单位切换：`targetSizeMB` → `targetSize` + `sizeUnit`，unit-chip 切换含数值换算（MB→KB ×1024 取整、KB→MB ÷1024 留 2 位），导出 `targetBytes` 按单位换算，ops 标签带单位 | gifEditor + gifBatch 的 .js/.wxml/.wxss |
| 4 | 报告/草稿入口从「导出结果」卡片上移到「导出」卡片 cross-link 之下常驻（选好 GIF 即可见），结果区去重 | pages/gifEditor/gifEditor.wxml |
| 5 | canvas 补 `catchtouchcancel`（系统中断不丢笔画提交）；gifEditor.wxss 补原本缺失的 `.size-input`/`.compress-row` 样式 | gifEditor.wxml/.wxss |

内存依据：全部帧模式若沿用整帧快照 × 10 步 × N 帧，30 帧 480px 最坏 ~276MB；区域快照后典型笔画仅 bbox 大小。`_strokeBase` 瞬态副本 stroke 结束即释放。

## 阶段进度
| 阶段 | 状态 | 评审轮次 | 产出物 |
|---|---|---|---|
| 1 需求分析 | ✅ | - | 本文件（探查含 file:line 定位 + 存量 bug 发现） |
| 2 需求评审 | ✅ | - | 计划已获用户批准（plan mode） |
| 3 编码实现 | ✅ | - | 改动文件见下 |
| 4 编码评审 | ✅ | 1 | 独立 reviewer 全量审（Critical=0 / Important=3 / Minor=7），Important 与可廉价修复的 Minor 已全部修复并复跑回归；M-1/M-2 记为已知语义边界，M-5 记为后续项 |
| 5 验证用例设计 | ✅ | - | 本文件「手动验证用例」 |
| 6 验证用例评审 | ⏳ | - | 待 |
| 7 构建部署 | ✅ | - | 无云函数/npm/utils 改动，无需构建 npm |
| 8 预览验证 | ⏳ HITL | - | node 已全过（见下）；DevTools/真机用例待执行 |
| 9 部署验证 | ⏳ | - | - |
| 10 用户确认 | ⏳ HITL⑤ | - | - |

## 验证证据

### node（已执行，2026-09-15）
- **新增** `scripts/gif-stroke-undo-test.js`：32 断言全过（评审后补充竞态用例[7]）。以与页面逐行同构的 mock 验证撤销算法——单帧 undo/redo 往返、全部帧联动回退/恢复、混合笔画（全帧笔 A + 单帧笔 B → 其他帧 undo A 时 B 保留）、bbox 并集覆盖、栈深上限 10、画布外笔画不入栈、**笔画中途切作用域竞态（起笔锁定）**、**存量 bug 回归（undo 必须真正回退）**。
- **既有回归**：gif-adaptive-test / gif-adv-test / gif-decoder.test / gif-engine-test / gif-report-test 共 318 断言零失败（utils 本变更零改动，纯回归；修复后复跑仍全过）。
- 页面 JS 语法检查通过（gifEditor.js / gifBatch.js）。

### 编码评审（轮次 1，独立 reviewer）与修复
- **I-1** `toggleFrameSelect` dataset index 未 `Number()` 强转 → 字符串 currentFrame 污染擦除 hint/帧高亮/undo 联动 → **已修**（两分支统一强转）。
- **I-2** `_strokeBase` 无兜底清理（模式 tab 二指误触/重新选择/加载新文件 → 'all' 作用域全帧副本最坏 ~55MB 悬挂）→ **已修**（新增 `_abortEraseStroke()`，setMode 离开 erase / resetAll / _loadGifFile 三处调用）。
- **I-3** 草稿重放坐标系错位（存量）：裁剪后记录的笔画是裁剪后坐标，restoreDraft 却在原始尺寸重放再裁剪 → 位置错位/静默丢失 → **已修**（重放顺序改为先裁剪后重放；顺带修复重放后 `_eraseStrokes` 未登记导致再存草稿丢擦除效果的存量问题）。
- **M-3** KB→MB 下限抬 0.1MB 使小目标膨胀百倍 → **已修**（3 位小数，min 0.001）；onTargetSize NaN → **已修**（消毒为 0）；ops 标签与压缩行为对齐（仅实际压缩时记录）；压缩开着但目标无效时 toast 明示不静默降级（两页）。
- **M-4** undoCrop 不清 `_cropState`（幽灵 crop 进草稿）→ **已修**（一行）。
- **M-7** gifBatch 死样式 `.size-unit` → **已删**；测试 mock `_restoreEntry` 改读 page.data 保持同构 → **已修**。
- **M-1/M-2 已知语义边界（不修，记录）**：>10 笔混合作用域时 UNDO_LIMIT 溢出会使联动笔画在帧间失同步；撤销全帧笔 A 后画新笔 C 再从其他帧 redo A，画过 C 的帧静默缺失。触发条件均为边缘场景，无崩溃。
- **M-5 后续项**：gifDrafts 的 `?restoreDraft=1` 是死参数（onLoad 不读，落地后仍需点 banner 恢复）。
- **M-6 接受**：'all' 作用域起笔内存尖峰（最坏 ~55MB 瞬态，上限封顶，注释自述）。

### 手动验证用例（待 DevTools/真机）
1. 擦除-单帧：涂抹只影响当前帧；undo 真正回退（旧版空操作）；redo 恢复。
2. 擦除-全部帧：切作用域涂抹后逐帧切换核对每帧被擦；任一帧 undo → 所有帧回退；redo 联动；hint 文案随作用域切换。
3. 混合：全部帧擦 A → 帧1 单帧擦 B → 帧2 undo → 帧1 的 B 保留。
4. 草稿：全部帧擦除 → 杀进程重进 → 草稿恢复后全帧擦除效果在；**裁剪后再擦除 → 恢复草稿 → 擦除位置正确（I-3 修复回归）**；恢复后再编辑触发自动存草稿 → 二次恢复擦除效果仍在。
5. 单位：KB/MB 切换数值换算（1MB↔1024KB；1KB→0.001MB）；500KB 导出命中或提示未达标；MB 路径回归；目标清空/0 时导出有 toast 明示。
6. 入口：选 GIF 不导出，导出卡片两链接可见可跳；导出后结果区无重复。
7. 涂抹流畅性（全部帧模式多帧 touchmove 不卡顿）；编辑模式点帧列表切帧后进擦除模式，hint 帧号正确（I-1 回归）。

## 改动文件
- `pages/gifEditor/gifEditor.js` — eraseScope/作用域 handler；撤销重构（_beginEraseStroke/_commitEraseStroke/_pushFrameUndo/_restoreEntry/_pullLinkedEntry/_abortEraseStroke 替换 _pushEraseUndo）；草稿重放重排序（先裁剪后重放）+ frame:-1 + 笔画重登记；toggleFrameSelect index 强转；undoCrop 清 _cropState；KB/MB（targetSize/sizeUnit/setSizeUnit/导出换算/ops 标签/无效目标 toast）
- `pages/gifEditor/gifEditor.wxml` — 作用范围 chip 行 + 动态 hint；catchtouchcancel；unit-chip；报告/草稿入口上移导出卡片
- `pages/gifEditor/gifEditor.wxss` — 补 .compress-row/.size-input/.unit-chip 样式（原本缺失）
- `pages/gifBatch/gifBatch.js` — KB/MB（同 gifEditor 模式）+ 无效目标 toast
- `pages/gifBatch/gifBatch.wxml` — unit-chip
- `pages/gifBatch/gifBatch.wxss` — .unit-chip 样式（删死样式 .size-unit）
- `scripts/gif-stroke-undo-test.js` — 新增（撤销算法回归，32 断言）

## 关键决议
- HITL①（需求）：入口位置用户裁决「导出卡片常驻」；KB 单位用户裁决「gifEditor + gifBatch 两页都加」。
- gifBatch 不加报告/草稿链接：沿用 fix-gif-polish-20260914 决议（gifBatch 不写报告、无草稿，链过去是空内容）。
- 撤销区域快照复用 feat-gifeditor-adv-20260906 已建 `snapshotRect`/`restoreRect`，utils 零改动。
- 全部帧笔画 undo 跨帧联动采用 strokeId splice（含栈中间位置）；已知可接受边界：其他帧同笔之上若压了后画的单帧笔画且区域重叠，恢复会覆盖重叠像素（罕见，不处理）。
- HITL②（spec 批准）✅；HITL③④⑤待对应阶段。

## 产出物索引
- 计划文件：`C:\Users\Administrator\.claude\plans\woolly-discovering-clarke.md`（已获批准）
- 回归脚本：`scripts/gif-stroke-undo-test.js`

## 教训沉淀
- 撤销快照时机：**必须在破坏性操作前采集**；touchend 压"当前状态"会让 undo 变空操作（页面层代码 node 回归测不到，靠算法同构测试补位）。
- 页面层算法无法直接 node 测试时，用「与页面逐行同构的 mock + 真实 utils 函数」做等价验证是可落地的证据形态（scripts/gif-stroke-undo-test.js 模式）。
