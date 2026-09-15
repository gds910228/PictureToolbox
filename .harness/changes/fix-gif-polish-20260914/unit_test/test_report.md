# 验证用例清单（fix-gif-polish-20260914）

> 本项目无测试框架。引擎层回归 = scripts/ 下 node 测试（已实际运行，见下）；页面层 = 微信开发者工具 + 真机手动验证。**Issue 2/3（缩略图噪点、擦除偏移）是真机专属症状（DevTools 无法复现），必须真机验证。**

## 已执行：node 回归（引擎 utils/ 本次零改动，纯回归）

| 脚本 | 结果 |
|---|---|
| scripts/gif-decoder.test.js | PASS 87 / FAIL 0 |
| scripts/gif-report-test.js | PASS 58 / FAIL 0 |
| scripts/gif-engine-test.js | PASS 48 / FAIL 0 |
| scripts/gif-adv-test.js | PASS 74 / FAIL 0 |
| scripts/gif-adaptive-test.js | PASS 51 / FAIL 0 |
| scripts/gif-bench.js | 全部目标 PASS（局部变化样本缩减 66.5%≥40%；round-trip 逐像素差 0） |
| scripts/gif-fuzz.js | a/b/c 三类各 500 次 PASS |
| node --check | 4 个改动页面 JS 语法 OK |

## 待执行：开发者工具验证

### V1 首页入口（Issue 1）
- [ ] 创意玩法组不出现"导出报告""草稿管理"卡片；GIF编辑器/GIF批量处理仍在
- [ ] 编译无报错；console 执行 `wx.navigateTo({url:'/pages/gifReport/gifReport'})` 仍可路由（app.json 注册保留）
- [ ] gifEditor 导出成功后结果面板"查看导出报告/草稿管理"链接可跳转

### V2 报告页 NaN（Issue 4）
- [ ] 有导出记录时点"查看记录信息"：详情含 输出 WxH·N帧·x.xx MB、压缩比 xx.x%、无 NaN
- [ ] ≥2 条记录：趋势图折线/洋红点/min-max 标签正常绘制（非空白）
- [ ] 选 2 条对比正常（回归确认未被本次改动破坏）
- [ ] 清空后再从 gifEditor 导出：列表/概览/趋势图重建正常

### V3 编辑器（Issue 5 编辑器侧）
- [ ] 选 >480px GIF：立即弹"尺寸过大"（无解码进度爬行）
- [ ] 选 >60 帧 GIF：弹"帧数过多"
- [ ] 正常 GIF 导入：进度"解码帧 n/m"逐帧推进，console 无 setData/JS 执行性能告警
- [ ] 草稿恢复后文件信息显示真实体积（非 "0 B"）
- [ ] 播放中切到报告页再返回：预览已停止，console 无残留 setData

### V4 批量页（Issue 5 批量侧）
- [ ] 多选 3-5 个 GIF：卡片即时全部出现，解码状态逐个翻转
- [ ] **解码进行中点调速/裁剪/倒放/压缩 chip：立即响应（原症状：卡顿数秒）**
- [ ] 开始批量处理正常完成、保存正常
- [ ] 移除某文件后再处理其余文件：不报"帧数据丢失"

## 待执行：真机预览验证（Issue 2/3 必须）

### V5 缩略图（Issue 2）
- [ ] 导入 GIF：帧列表缩略图为真实帧内容缩小图（非彩色噪点）
- [ ] 滚动帧列表：懒加载批次正常
- [ ] 裁剪后：缩略图按新比例重新生成

### V6 擦除（Issue 3）
- [ ] 擦除模式手指涂抹：痕迹**实时**出现在指尖位置
- [ ] 涂抹时页面不滚动；切回编辑模式在画布上拖动页面可滚动（catch 条件绑定验证）
- [ ] 导出 GIF：透明孔位与涂抹位置完全一致（无偏移）
- [ ] 撤销/重做正常；擦除穿过已加文字附近时文字不被视觉误擦

### V7 性能（Issue 5 真机）
- [ ] 导入 GIF 后无微信性能提示
- [ ] 杀掉小程序重进：批量页重复 V4 操作依然流畅（确认非重启即愈的偶发现象）
