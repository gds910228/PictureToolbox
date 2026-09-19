# tune-gif-import-ux-20260919

- 类型：tune
- 创建：2026-09-19（北京）
- 状态：进行中（停 HITL③/⑧——等用户真机验证）

## 阶段进度
| 阶段 | 状态 | 评审轮次 | 产出物 |
|---|---|---|---|
| 1 需求分析 | ✅ | - | request_analysis/spec.md |
| 2 需求评审 | ✅（会话内评审，方案口头批准） | 0 | - |
| 3 编码实现 | ✅ | - | coding/coding_report_v1.md（commit 4abbbc9 + Minor 修复） |
| 4 编码评审 | ✅ | 1 | coding/review/code_review_v1.md（0C/0I/5Minor，Minor 全修） |
| 5 验证用例设计 | ✅ | - | unit_test/test_report.md（11 用例） |
| 6 验证用例评审 | ✅（并入编码评审员复核，见 test_report 头注） | - | - |
| 7 构建部署 | ⏳ 无云函数/无 npm 变更，仅需开发者工具编译（用例 D2） | - | - |
| 8 预览验证 | ⏳ HITL——等用户真机执行 11 用例 | - | - |
| 9 部署验证 | ⏳ | - | - |
| 10 用户确认 | ⏳ HITL⑤ | - | - |

## 验证用例数
14 条（v1 11 条 + v2 追加 E1-E3），待真机执行

## 关键决议
- HITL①：根因为 chooseMessageFile type:'file' 只认文件消息 + 相册 API 拿不到原始动图（非权限问题）；已与用户对齐。
- HITL②：方案（双入口 + 导入指引 + 报错分来源，不改 type:'file'）用户已批准（2026-09-19）。
- **方案修订 v2（2026-09-19，真机反馈驱动）**：用户实测"无论怎么发都无结果"（发的均为图片气泡形式）→ 推翻"不放宽 type"预判，主入口改 `type:'all'` 去 extension，任意形式 GIF 均可见，GIF8 校验兜底。spec §7 有完整修订记录与去留判据。
- HITL③：编码评审 0C/0I/5Minor 全修后 APPROVED，待用户确认进入真机验证。
- HITL④⑤：待真机验证后。

## 产出物索引
- request_analysis/spec.md
- coding/coding_report_v1.md
- coding/review/code_review_v1.md
- unit_test/test_report.md

## 教训沉淀
（待收尾沉淀进 memory）chooseMessageFile type:'file' 只列文件消息，图片/表情消息不可见——引导文案必须写明"以文件形式发送"这个动作；wx.chooseMedia 相册选 GIF 平台会转静态 JPG，相册入口只能做"试试"+头部校验兜底。
