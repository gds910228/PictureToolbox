# spec — feat-greetingAnim-20261024「今日问候·动图」

## 背景

问候 MVP（feat-greetingMvp-20261023）已上线跑通。用户选定方案②：GIF 动图·文字动效
（"会动的早安图"正是长辈问候文化的经典形态）。初版范围：文字呼吸 + 逐字浮现两种动效。
**真机验证通过后追加**（见 summary 迭代记录）：dither 开启、照片缓推（Ken Burns，
1→1.05→1 呼吸式，作用于两种动效态，不新增选项）。

## 复用与决策

- 编码器：复用 `pkgGif/utils/gif-encoder.js`（自研 LZW，omggif 交叉验证 + fuzz 测试）。
  跨分包不可 require → **复制**到 `pkgGreeting/utils/`（26.6KB；其懒加载的
  `../../utils/color-quantize.js` 相对深度不变，仍指向主包量化器）。
- 帧渲染：现有绘制代码收进 `_drawGreeting(ctx, t, imgs, animKind)`（t∈[0,1]），
  设计坐标系保持 1080×1440，GIF 帧用 canvas 720×960 + `ctx.scale(2/3)`，布局零重写。
- 帧循环：呼吸 12 帧 / 逐字 16 帧（10 帧打字 + 6 帧停留），100ms/帧，无限循环
  （`loop: 0`），帧间 `setTimeout(0)` 让出主线程。
- 出口分支：`动效=无` → 现有 1080×1440 JPG；选动效 → 720×960 GIF
  （`buildGIF(frames, {width, height, loop:0, dither:false})`）写 `USER_DATA_PATH`。
- 发送：GIF 走 gifEditor 生产验证过的 `wx.shareFileMessage`（低版本兜底存相册）；
  保存走 `imageProcess.saveImageToPhotosAlbum`（GIF 套件同款包装器，含授权流程）。
- UI：步骤 2 增"动效"选项行（不动/文字呼吸/逐字浮现，默认不动）；成品预览 image 组件
  直接动图播放。
- 埋点：`greeting_render` 增 `anim` 字段（不新增事件名，免后台登记）。

## 明确不做（本期）

抖动优化（留开关待真机定）、Ken Burns 照片动效（二期）、标题/日期/尾签动画、视频 MP4。

## 验证

node 侧编码器烟雾测试（合成帧 → GIF89a 头/NETSCAPE2.0/尾字节）+ 真机用例
（动效渲染、发送链路、低端机耗时、文件大小、静图回归）。
