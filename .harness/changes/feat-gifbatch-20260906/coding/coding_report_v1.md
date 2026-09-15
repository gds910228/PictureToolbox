# 编码报告：GIF 工具链收官（v1）

- 日期：2026-09-06
- 状态：✅ 完成

## 变更文件

| 文件 | 类型 | 行数 | 说明 |
|------|------|------|------|
| `utils/gif-compress.js` | 新增 | 267 | 目标体积压缩引擎 |
| `utils/gif-effects.js` | 新增 | 200 | 帧特效纯函数 |
| `utils/gif-decoder.js` | 修改 | +120 | 新增 decodeGifChunked 分块解码 |
| `scripts/gif-engine-test.js` | 新增 | 431 | 引擎综合测试 + Fuzz D |
| `pages/gifBatch/gifBatch.js` | 新增 | 324 | 批量处理页面逻辑 |
| `pages/gifBatch/gifBatch.wxml` | 新增 | 113 | 批量处理页面结构 |
| `pages/gifBatch/gifBatch.wxss` | 新增 | 130 | 批量处理页面样式 |
| `pages/gifBatch/gifBatch.json` | 新增 | 4 | 页面配置 |
| `pages/gifEditor/gifEditor.js` | 修改 | +30 | 压缩选项 + 分块解码 |
| `pages/gifEditor/gifEditor.wxml` | 修改 | +15 | 压缩开关 UI |
| `pages/index/index.js` | 修改 | +10 | 注册 gifBatch |
| `pages/index/index.wxss` | 修改 | +25 | gifBatch 图标 |
| `app.json` | 修改 | +1 | 注册页面路由 |

## 一、压缩引擎（gif-compress.js）

### 算法
策略阶梯（9 级），从原始到最激进：
1. 原始 + 固定色板
2. 原始 + 自适应色板
3. 缩放 0.875
4. 缩放 0.75
5. 缩放 0.75 + 每 2 帧取 1（延时×2）
6. 缩放 0.625 + 每 2 帧取 1
7. 缩放 0.5 + 每 2 帧取 1
8. 缩放 0.5 + 每 3 帧取 1（延时×3）
9. 缩放 0.25 + 每 4 帧取 1

帧抽取保首尾帧，延时按组累加保持总时长。

### 数据表（node 实测）

| 样本 | 目标 | 结果体积 | 策略 | 帧数 | 命中 |
|------|------|----------|------|------|------|
| gradient 100×100×10 | 70% | 43% | scale0.75-step2 | 6 | ✓ |
| gradient 100×100×10 | 40% | 36% | scale0.625-step2 | 6 | ✓ |
| gradient 100×100×10 | 20% | 19% | scale0.5-step3 | 4 | ✓ |
| photo 100×100×10 | 70% | 44% | scale0.75-step2 | 6 | ✓ |
| photo 100×100×10 | 40% | 36% | scale0.625-step2 | 6 | ✓ |
| photo 100×100×10 | 20% | 19% | scale0.5-step3 | 4 | ✓ |
| screen-rec 100×100×30 | 70% | 61% | scale0.75-step2 | 16 | ✓ |
| screen-rec 100×100×30 | 40% | 36% | scale0.25-step4 | 9 | ✓ |
| screen-rec 100×100×30 | 20% | 36% | scale0.25-step4-best | 9 | best |

## 二、帧特效（gif-effects.js）

| 特效 | 实现 |
|------|------|
| 发光描边 | 亮度边缘检测 + 发光色叠加 |
| 故障风 | RGB 通道水平偏移 + 随机撕裂条 |
| 暗角 | 径向渐变变暗（中心→边缘） |
| 淡入淡出 | 按帧位置 alpha 渐变 |

全部 in-place 修改 rgba，返回变化 bbox，无 wx/canvas 依赖。

## 三、分块解码（decodeGifChunked）

- 第一阶段：解析 GIF 结构（同步，快），存储 LZW 原始字节
- 第二阶段：分批 LZW 解码 + 合成（batchSize=4，setTimeout 让出主线程）
- onProgress(decoded, total) 回调
- shouldCancel() 支持中途取消
- 与 decodeGif 输出像素级一致（测试验证）

## 四、批量处理页面

- 多选 ≤9 GIF，串行解码→处理→编码
- 每文件状态：decoding → ready → processing → done/failed
- 全局操作：调速/倒放/裁剪比例/目标压缩
- 单文件重试/移除/保存
- 批量保存到相册

## 五、发现并修复的 Bug

### Bug: glitch 特效撕裂条越界像素 alpha 归零
- **现象**：glitchEffect 后部分像素 alpha=0（应保持 255）
- **根因**：撕裂条位移时，越界位置的 rowCopy 初始化为 0（alpha=0），覆盖了原始像素
- **修复**：rowCopy 先复制原始行数据，再仅替换有源位置的像素
- **复现**：engine-test.js [2] glitch preserves alpha

## 六、验证证据

```
解码器单测:      87 PASS
进阶编辑单测:    74 PASS
自适应单测:      51 PASS
引擎综合测试:    31 断言 PASS
Fuzz D (500):   500 PASS
Fuzz D seeds:   400 PASS (seeds 42, 999)
Fuzz A/B/C:     1800 PASS (seeds 88888, 99999, 123456)
总计:           2943 断言/迭代，0 失败
```
