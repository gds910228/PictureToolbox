# 任务拆分

## Task 1：index.wxml navigator 改造
- 热门场景卡：`<view class="hot-scene-card" data-url bindtap="onSceneTap">` → `<navigator url="{{item.url}}" hover-class="none" class="hot-scene-card" bindtap="onSceneTap">`，data-url 可留可删（navigator 自带 url）。
- 工具卡：`<view class="tool-card ..." data-url data-available bindtap="onToolTap">` → `<navigator url="{{item.available ? item.url : ''}}" hover-class="none" class="tool-card ..." bindtap="onToolTap">`，data-* 保留（onToolTap 仍读 dataset.available 做拦截）。
- 验收：wxml 结构闭合；hover-class="none" 到位；available=false 时 url 为空串。

## Task 2：index.js handler 简化
- `onToolTap`：去掉 `wx.navigateTo({url})`（navigator 接管）；保留 available 判断与"功能开发中"toast。
- `onSceneTap`：去掉 `wx.navigateTo({url})`；保留 `analytics.track('hot_scene_click', {url})`。
- 验收：两个 handler 内无 `wx.navigateTo` 残留；埋点/拦截逻辑不变。

## Task 3：sitemap.json 覆盖最大化
- 新增 18 页 allow 规则（见 spec 第七节清单）。
- 更正注释：描述实际为"全部已上线工具页收录（覆盖最大化）"。
- 验收：29 页全部 allow；JSON 语法合法；注释与行为一致。

## 依赖
Task 1/2 同改首页，强相关，同一人连续改。Task 3 独立。
