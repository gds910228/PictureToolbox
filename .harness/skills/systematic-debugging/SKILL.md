---
name: systematic-debugging
source: superpowers:systematic-debugging
harness_phase: 阶段四（按需，不在十阶段主链）
---

# 系统化调试（Systematic Debugging）

> 源自 superpowers `systematic-debugging`，按本项目改造。四阶段根因法。

## 铁律

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

遇任何 bug / 失败 / 异常行为，**先查根因再改**。盲改 = 浪费时间 + 制造新 bug。已试 2+ 次修复仍失败时尤其要停。

## 四阶段（必须依次，不可跳）

### 阶段1：根因调查
- **读全错误**：云开发控制台日志、开发者工具 Console、stack trace、行号、错误码。不跳过。
- **稳定复现**：哪步触发？每次都现？不能稳定复现 -> 多取证，别猜。
- **查近期改动**：git diff / 近期 commit / 新依赖 / 配置变更。
- **多层取证**（on-device <-> 云函数 <-> Hunyuan <-> 内容安全 多层链路）：在每个边界打日志，确认断在哪层。
- **回溯数据流**：错值从哪来？谁传的？追到源头修，不在症状处修。

### 阶段2：模式分析
- 找同类能跑的代码（aiOutpaint 是扩图同步参考、aiTextToImage 是异步参考、aiAvatar 是同步+base64参考）。
- 完整读参考实现（别扫读），列出与出错代码的每个差异，别假设"这无所谓"。

### 阶段3：假设与测试
- 写下单一假设："我认为根因是 X，因为 Y"。
- 最小改动验证，一次一个变量，不叠改。
- 不灵 -> 新假设，不在失败的修复上继续加。

### 阶段4：实现修复
- 先造能复现的失败用例（无框架就写一次性脚本 / 开发者工具里手动复现路径）。
- 单一修复，只改根因，不夹带"顺手优化"。
- 验证：原症状消失？没引入新问题？
- **3+ 次修复失败 -> 停，质疑架构**（每次修复都暴露新耦合 / 新位置的问题 = 架构错了，不是假设错），与人讨论后再动。

## 本项目调试适配

| 场景 | 取证方式 |
|---|---|
| 云函数 | 云开发控制台 -> 云函数日志；注意 UTC 时区；content-check 要分清"确认违规" vs "服务异常 FAIL_OPEN" |
| Hunyuan | 消息双格式（Contents vs Content）；3-tier JSON parse 失败看原始返回；demo/mock vs success:false 分清 |
| on-device | 微信开发者工具 Console + 真机预览；canvas 2D API 差异；dataset index 是字符串；bindtap 首参是事件对象 |
| 限流 | 控制台查 rate_limit 集合文档计数；北京日是否算对；集合缺失是否走了 catch 降级 |
| 隐写 / 编码 | JPEG 4:2:0 是否抹平蓝 LSB；GIF LZW 码宽 / NETSCAPE 魔数；用口碑库交叉验证输出 |

## 红线

- "先改了再说" / "改改看" / "多改几处一起跑" -> 停，回阶段1。
- 2+ 次失败仍"再试一次" -> 停，回阶段1 或质疑架构。
- 不读参考实现就"适配模式" -> 必读全。
- 修完不验证就声称修好 -> 见 verification-before-completion。
