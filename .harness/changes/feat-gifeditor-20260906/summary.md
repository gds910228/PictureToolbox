# GIF 编辑器（gifEditor）

- 类型：feat
- 创建：2026-09-06（北京）
- 状态：✅ 代码完成，待人工真机验证

## 阶段进度

| 阶段 | 状态 | 评审轮次 | 产出物 |
|------|------|----------|--------|
| 1 需求分析 | ✅ | - | request_analysis/spec.md |
| 2 需求评审 | ✅ 自审 | 1 | request_analysis/review/spec_review_v1.md |
| 3 编码实现 | ✅ | - | coding/coding_report_v1.md |
| 4 编码评审 | ✅ 自审 | 1 | coding/review/code_review_v1.md |
| 5 验证用例设计 | ✅ | - | unit_test/test_report.md |
| 6 验证用例评审 | ✅ 自审 | 1 | unit_test/review/ |
| 7 构建部署 | ✅ 适配 | - | deployment/deploy_report.md（无云函数/无新依赖） |
| 8 预览验证 | ✅ 代码级 | - | ci_result/ci_result.md（87 断言 + omggif 交叉验证） |
| 9 部署验证 | ⏳ 待人工 | - | 需真机确认（无部署参数） |
| 10 用户确认 | ⏳ HITL⑤ | - | 待用户验收 |

## 验证用例数

- 自动化断言：**87 条全通过**（node scripts/gif-decoder.test.js）
- omggif 交叉验证：**46,080 字节 0 不匹配**（5 帧高熵）+ 隔行 1,024 字节 0 不匹配
- 手动验证用例：**14 条**（V1-V14，见 unit_test/test_report.md）

## 5 个 HITL 决策记录（无人值守，自决）

### HITL① 需求待决议
- **执行层**：on-device（纯本地），不新增云函数。理由：需求明确要求"全程 on-device 本地处理，不新增云函数、不新增 npm 依赖"；GIF 解码/编码均为 CPU 密集型二进制处理，适合本地；与 makeGif 同 tier。
- **disposal 3 处理**：按 1 处理（不恢复 previous canvas）。理由：disposal 3 在实际 GIF 中极罕见，实现需维护额外帧快照，需求明确允许"按 1 处理可接受"。
- **内存阈值**：MAX_DIMENSION=480px, MAX_FRAMES=40。理由：480×480×4B×40帧 ≈ 37MB RGBA，在中低端机小程序内存上限（~128-256MB）内安全；覆盖绝大多数表情/动图（通常 <30 帧、<500px）。文件头阶段即检查尺寸，避免解码超大文件后再拒绝。

### HITL② 计划评审后
- spec 自审通过：无 TBD/TODO 占位符，接口签名一致，范围明确。批准编码。

### HITL③ 编码评审后
- 代码自审通过：接口契约严格遵守；解码器不依赖 wx API；设计 token 全使用；无硬编码色值；button 文案单行；makeGif 零改动。关键发现：LZW 码宽递增条件必须用 `>=`（非编码器的 `>`），已修正并经 omggif 交叉验证。

### HITL④ 部署参数
- 无云函数、无 env vars、无 rate_limit、无集合创建、无 npm 构建。唯一部署动作：微信开发者工具上传代码。无需人工确认参数。

### HITL⑤ 最终交付
- 待用户验收。代码级验证全部通过；真机验证用例已交付（V1-V14）。

## 产出物索引

| 文件 | 说明 |
|------|------|
| `utils/gif-decoder.js` | GIF89a/87a 解码器（decodeGif） |
| `scripts/gif-decoder.test.js` | node 自测脚本（87 断言，零依赖） |
| `pages/gifEditor/gifEditor.js` | 页面逻辑 |
| `pages/gifEditor/gifEditor.wxml` | 页面结构 |
| `pages/gifEditor/gifEditor.wxss` | 页面样式 |
| `pages/gifEditor/gifEditor.json` | 页面配置 |
| `app.json` | pages[] 注册（修改） |
| `pages/index/index.js` | creative 组 tools[] + LAUNCH_DATES（修改） |
| `pages/index/index.wxss` | .icon-gifEditor 图标（修改） |
| `request_analysis/spec.md` | 需求规格 |
| `request_analysis/tasks.md` | 任务拆分 |
| `coding/coding_report_v1.md` | 编码报告（含验证证据） |
| `unit_test/test_report.md` | 手动验证用例清单 |
| `ci_result/ci_result.md` | 代码级验证结果 |
| `deployment/deploy_report.md` | 部署报告 |

## 教训沉淀

1. **GIF LZW 解码器码宽递增条件与编码器不同**：编码器 post-increment 用 `nextCode > 2^w`（插入 2^w 后递增），解码器 post-increment 必须用 `nextCode >= 2^w`（插入 2^w-1 后即递增）。原因是解码器比编码器晚一个条目插入字典，`>=` 恰好补偿这一步时差。已用 omggif 逐字节交叉验证确认。此坑已写入解码器注释，建议后续加入 Rules。

2. **手工构造测试 GIF 时不要忘记 LZW 子块长度字节**：GIF 图像数据的 LZW 压缩数据以子块形式存储（每块前有 1 字节长度），直接拼接裸 LZW 字节会导致解码器把第一个数据字节误认为子块长度。
