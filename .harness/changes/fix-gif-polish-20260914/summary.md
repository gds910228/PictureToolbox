# fix-gif-polish-20260914

- 类型：fix
- 创建：2026-09-14（北京）
- 状态：进行中

## 背景

GIF 编辑器套件（gifEditor / gifBatch / gifReport / gifDrafts，多轮众测开发产物）真机使用发现 5 个问题，本变更一次性修复。**全部为页面层问题，不动 `utils/` 引擎**（node 测试为纯回归）。

## 问题清单与根因

| # | 现象 | 根因 | 修复文件 |
|---|---|---|---|
| 1 | 首页入口污染：导出报告/草稿管理不应作为功能入口 | 辅助页被注册为首页工具（编辑器结果面板已有入口链接） | pages/index/index.js + index.wxss |
| 2 | 帧列表缩略图显示彩色噪点 | `_makeThumbnail` 在隐藏 WXML canvas 上 putImageData 后同 tick 立即 canvasToTempFilePath，真机未光栅化 → 拍到未初始化显存（DevTools 同步光栅化所以测试未发现） | pages/gifEditor/gifEditor.js + .wxml |
| 3 | 擦除涂抹无痕迹 + 导出位置偏移 | ① `_touchToCanvas` 多减了 rect.left/top（canvas touch 坐标本就相对 canvas，aiEraser.js:351 已验证模式）；② touchmove 插值循环只改内存不重绘 | pages/gifEditor/gifEditor.js + .wxml |
| 4 | 报告页数据 NaN（对比正常） | `_loadRecords` 展示映射丢弃原始数值字段（outputSize/matchRate 等），viewDetail 与趋势图消费被剥字段记录 → undefined 运算；对比用原始 _store 所以正常 | pages/gifReport/gifReport.js |
| 5 | 导入 GIF 性能警告 + 批量配置卡顿数秒（重启依旧） | gifBatch 把整帧 rgba 塞 data.files 且每次全量 setData（序列化几十~几百 MB）；同步解码背靠背；gifEditor ≤5MB 走同步解码；导入同步 writeFileSync 整个源文件；播放每帧 setData 最高 50Hz 且无 onHide；MAX_FRAMES 从未强制 | pages/gifBatch/gifBatch.js + pages/gifEditor/gifEditor.js |

## 阶段进度
| 阶段 | 状态 | 评审轮次 | 产出物 |
|---|---|---|---|
| 1 需求分析 | ✅ | - | 本文件问题清单（用户报障 5 条 + 探索定位根因） |
| 2 需求评审 | ✅ | - | 计划已获用户批准（plan mode） |
| 3 编码实现 | ✅ | - | 改动文件见下 |
| 4 编码评审 | ✅ | - | 编码中逐项核对了探索代理的 file:line 结论（含 2 处人工复读代码核验）；改动为最小 diff |
| 5 验证用例设计 | ✅ | - | unit_test/test_report.md（V1-V7） |
| 6 验证用例评审 | ⏳ | - | 待用户真机执行 |
| 7 构建部署 | ✅ | - | 无云函数/npm/utils 改动，无需构建 npm |
| 8 预览验证 | ⏳ HITL | - | node 回归已全过（见下）；DevTools/真机用例待执行 |
| 9 部署验证 | ⏳ | - | - |
| 10 用户确认 | ⏳ HITL⑤ | - | - |

## 验证用例数
node 回归 7 脚本全过（87+58+48+74+51 断言 + bench + fuzz 3×500，utils 零改动纯回归）；手动用例 V1-V7 共 24 条待 DevTools/真机执行。

## 改动文件
- `pages/index/index.js` — 删 gifReport/gifDrafts 工具对象与 LAUNCH_DATES
- `pages/index/index.wxss` — 删两组 icon 规则与 @keyframes
- `pages/gifReport/gifReport.js` — 展示映射补回原始数值字段；_store 移实例字段；抽 _buildAgg；clearHistory 重置 _store
- `pages/gifEditor/gifEditor.js` — _makeThumbnail 改离屏 canvas；_touchToCanvas 去 rect 减法；擦除节流重绘；头部预检+一律 chunked 解码；MAX_FRAMES 强制；源文件异步写+草稿恢复跳过+体积兜底；播放 setData 节流 250ms；加 onHide
- `pages/gifEditor/gifEditor.wxml` — 删 thumbCanvas；previewCanvas 擦除绑定改 catchtouch*
- `pages/gifBatch/gifBatch.js` — 帧像素移出 data 到 _framesById；串行解码队列；chunked 解码；MAX_FRAMES=60 加固；removeFile 释放内存

## 关键决议
- HITL①（需求）：用户报障 5 条即需求，无歧义；gifReport/gifDrafts 保留页面与 app.json 注册，仅撤首页入口（编辑器结果面板链接即入口）。
- 不为 gifBatch 加报告/草稿链接：gifBatch 不写报告记录、无草稿，链过去是空内容；记为后续可选功能。
- 擦除实时反馈采用节流全量重绘而非 destination-out 覆盖层：语义与导出精确一致（不会视觉擦掉文字而内存保留）。
- 缩略图改 `wx.createOffscreenCanvas({type:'2d'})`：复用 utils/upscale-local.js 已上线模式，消除隐藏 canvas 光栅化时机依赖。
- HITL②~⑤：待对应阶段执行/确认。

## 产出物索引
- 计划文件：`C:\Users\Administrator\.claude\plans\temporal-finding-octopus.md`（已获批准）

## 教训沉淀
- canvas 组件 touch 事件坐标本就相对 canvas 元素，再减 boundingClientRect 会双扣偏移（真机表现为笔画整体偏左上/落画布外）→ 已加 memory `wx-canvas-touch-coords-canvas-relative`
- 隐藏 WXML canvas（fixed -9999rpx）真机不保证光栅化，putImageData 后同 tick canvasToTempFilePath 拍到未初始化显存 = 彩色噪点；DevTools 同步光栅化所以测不出 → 用 wx.createOffscreenCanvas 或先 yield，已加 memory `wx-hidden-canvas-rasterization-noise`
- 帧像素等大型 TypedArray 绝不能进 setData（每次状态更新全量深拷贝序列化，多文件时几十~几百 MB）→ 存实例字段（this._xxx），data 只放元数据
