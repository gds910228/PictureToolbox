# 编码报告 v1 — feat-greetingMvp-20261023

## 改动清单

**新增（pkgGreeting 分包，6 文件）**
- `pkgGreeting/data/templates.js` — 模板/时段/祝福池/2026 节日节气表（纯配置零素材）
- `pkgGreeting/pages/greeting/greeting.{js,wxml,wxss,json}` — 三步流程页 + Canvas 2D 出图（1080×1440 JPG）

**修改（5 文件）**
- `app.json` — 注册 pkgGreeting 分包（不进 preloadRule，保冷启动成果）
- `pages/index/index.js` — 热门场景 +1 卡、创意玩法组 +1 卡、LAUNCH_DATES.greeting='2026-10-23'
- `pages/index/index.wxss` — `.icon-greeting` 图标规则（沿用全局 token）
- `cloudfunctions/aiCaption/index.js` — 新增 mode='greeting' 分支（prompt/mock/签名向后兼容，缺省行为不变）
- `pages/compare/compare.js` — 补齐 P0 埋点（tool_view/tool_complete，全站最后一块 32/33）

## 静态验证证据（已执行）

- `node --check` 5 个改动/新增 JS 全部通过：greeting.js / templates.js / index.js / compare.js / aiCaption/index.js
- `app.json` / `greeting.json` JSON.parse 通过
- templates.js 逻辑实测：`getOccasion(new Date(2026,9,23))` → 霜降 ✓；`getOccasion(2026-10-01)` → 国庆节（节日优先于节气）✓；`slotIdByHour` ✓；模板 6 套 / 时段 3 / 早安池 6 条 ✓
- aiCaption 调用点一致性 grep：mockCaptions / callHunyuanAPI / buildPrompt 全部使用新签名，默认参数保证旧调用（aiCaption 页 mode 缺省 'social'）行为不变

## 未验证项（无本地运行时，转手工用例）

Canvas 真机渲染、showShareImageMenu、授权分支、分享落地链路 → 见 `../unit_test/test_report.md` 29 条用例，待真机预览执行。

## 设计约束遵守自检

- 定位红线：app.wxss / 全局主题零改动；首页仅 2 处入口（热门场景卡 + 创意玩法卡）；问候页 page 级浅色皮肤局部覆盖（含 `page::before` 局部关闭）
- 诱导分享：无任何解锁机制；尾签为唯一传播印记
- 内容安全：guardImage（选图）/ guardText（文案）；云端 assertImageSafe 随 aiCaption 既有链路生效
- 降级诚实：AI mock 态显式标注"示例"，服务失败不静默 mock（沿 aiCaption 既有约定）
