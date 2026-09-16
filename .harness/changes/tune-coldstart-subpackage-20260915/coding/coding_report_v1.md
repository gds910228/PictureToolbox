# coding_report_v1：三分包重构

- 日期：2026-09-15（北京）
- 执行模式：Inline（coding-skill 模式 B，单一机械性重构全上下文在手，派 subagent 反而需转译全部依赖清单）
- 工件：`coding/migrate-subpackage.js`（改写脚本，可追溯）、`coding/verify-subpackage.js`（验证脚本，证据生成）

## 任务完成情况

| 任务 | 状态 | 说明 |
|---|---|---|
| T1 死重清理 | ✅ | `git rm` pages/aiEnhance（4 文件 17K，2026-03 遗留未注册）+ images/placeholder.png（35K，无引用） |
| T2 pkgGif | ✅ | 5 页 + 6 utils；页面 require 改写 8 处 |
| T3 pkgAi | ✅ | 12 页 + colorize-detect；页面 require 改写 36 处 |
| T4 pkgTools | ✅ | 7 页 + 5 utils；页面 require 改写 12 处 |
| T5 注册与入口 | ✅ | app.json 重写（9 页 + 3 subpackages + preloadRule）；index.js 27 处 url；wxml navigator 5 处；分享 path 24 处；sitemap 20 处 + 手工补 4 个 GIF 页；全仓旧路径清扫 0 残留 |
| T6 验证 | ✅ | verify-subpackage.js ALL PASS（证据见下） |

## 改写计数（migrate-subpackage.js 输出）

- A 页面 require：56 处（pkgAi 36 + pkgGif 8 + pkgTools 12）
  - 与 spec 预期 55 的 +1：aiColorize.js:6 `upscale-local`（行尾带 `// 注释`，人工清单的 `grep -v "//"` 滤掉了，脚本正则抓全）→ **56 为正确值**
- B utils 内部定点：4/4（colorize-detect/image-hash/format-recommend→`../../utils/`，gif-encoder→`../../utils/color-quantize.js`；gif-compress 同包 2 处不动）
- C 路由路径：56 处（index.js 27 + 各页 js 24 + wxml 5）
- sitemap.json：20 处自动 + 4 处手工补录

## 验证证据（verify-subpackage.js，2026-09-15 实跑输出）

```
✅ JSON 合法: 35 个文件
✅ 注册页 33 个（主包 9 + 分包 24）四件套齐全，磁盘无孤儿
✅ require 解析: 114 条，全部通过（剥注释行后；此前 1 条误报为 analytics.js JSDoc 用法示例）
✅ 路由字面量 '/pages/x/x': 17 处，非主包残留 0
✅ sitemap: 33 条规则，未注册 0
✅ preloadRule: index -> pkgAi (network=all)
ALL PASS
```

## 体积核对（du 源码口径）

| 包 | 体积 | 限制 |
|---|---|---|
| 主包（pages 385 + utils 96 + components 33 + 全局 ~20） | **~534K** | <600K 目标 ✅（原 1.65MB，**-68%**） |
| pkgAi | 412K | <2MB ✅；preload 412K <2MB ✅ |
| pkgGif | 325K | <2MB ✅ |
| pkgTools | 379K | <2MB ✅ |

## 编码期新发现（spec 之外）

1. **sitemap.json 缺 4 个 GIF 页**（gifEditor/gifBatch/gifReport/gifDrafts，今日 e56e481 上线时未登记）——存量缺口，本次顺手补录并把 desc 更新为"33页（主包9+分包24）"。
2. aiColorize 的 `ensureBounded`（upscale-local）依赖在人工清单中被 grep 注释滤掉——依赖 spec §3 的 upscale-local 落位结论本来就留主包，无影响；教训：清单类 grep 别用 `grep -v "//"` 滤行。

## git 变更统计

77 R（纯改名）+ 31 RM（改名+改写）+ 3 M（app.json / sitemap.json / pages/index/index.js）+ 5 D（aiEnhance 四件套 + placeholder.png）+ 新增 .harness/changes/ 本目录。

## 未尽事项（进入阶段 4/7/8）

- 微信开发者工具真实编译（阶段 7 用户操作，node 静态验证已全过但无法替代官方编译器）
- 真机预览 33 页可达性 + 5 条功能链路（阶段 8）
