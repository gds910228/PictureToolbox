// utils/image-process.js - 图片处理核心工具函数

/**
 * 压缩图片
 * @param {string} filePath - 图片路径
 * @param {number} quality - 压缩质量 0-100
 * @returns {Promise<string>} 压缩后的图片路径
 */
function compressImage(filePath, quality = 80) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: filePath,
      quality: quality,
      success: (res) => {
        resolve(res.tempFilePath);
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

/**
 * 本地图像复杂度分析（canvas 2D，无需云函数/AI）。
 * 缩到 128 边采样画到离屏 canvas，读像素算 Sobel 边缘强度均值，
 * 据此映射图像类型 + 感知安全质量起点，供智能压缩画质自适应。
 * @param {string} filePath
 * @returns {Promise<{detail:number, imageType:string, suggestedQuality:number, minQuality:number}>}
 */
function analyzeImageComplexity(filePath) {
  return new Promise((resolve) => {
    const SAMPLE = 128; // 采样边长，足够反映细节又省内存/时间
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;
      if (!width || !height) { resolve(_complexityFallback()); return; }
      const scale = Math.min(SAMPLE / width, SAMPLE / height) || 1;
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));

      const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();

      image.onload = () => {
        try {
          ctx.drawImage(image, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;
          // Sobel 边缘强度均值（亮度通道，|gx|+|gy|）
          const lum = (p) => 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
          let sum = 0, count = 0;
          const stride = w * 4;
          for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
              const i = y * stride + x * 4;
              const gx = Math.abs(lum(i) - lum(i + 4));
              const gy = Math.abs(lum(i) - lum(i + stride));
              sum += gx + gy;
              count++;
            }
          }
          const edgeMean = count ? sum / count : 0; // 0~510
          resolve(_mapComplexity(edgeMean));
        } catch (e) {
          console.warn('[analyzeImageComplexity] 取像素失败', e);
          resolve(_complexityFallback());
        }
      };

      image.onerror = () => {
        console.warn('[analyzeImageComplexity] canvas 加载图片失败');
        resolve(_complexityFallback());
      };

      image.src = path;
    }).catch(() => resolve(_complexityFallback()));
  });
}

// 边缘强度均值 → 图像类型 + 质量起点（阈值经验值，真机可校准）
// edgeMean 典型：纯色~0、渐变~3、风景~10-25、人像~20-40、文字/截图~40-80+
function _mapComplexity(edgeMean) {
  let imageType, suggestedQuality, minQuality;
  if (edgeMean >= 40) {
    imageType = 'text';        // 文字/截图/线稿：高频细节，对压缩极敏感
    suggestedQuality = 90;
    minQuality = 78;
  } else if (edgeMean >= 22) {
    imageType = 'portrait';    // 人像/建筑：需保细节
    suggestedQuality = 84;
    minQuality = 65;
  } else if (edgeMean >= 8) {
    imageType = 'landscape';   // 风景：可适度压缩
    suggestedQuality = 76;
    minQuality = 50;
  } else {
    imageType = 'other';       // 渐变/纯色：可激进压缩
    suggestedQuality = 68;
    minQuality = 40;
  }
  return { detail: edgeMean, imageType, suggestedQuality, minQuality };
}

function _complexityFallback() {
  // canvas 不可用/解码失败时，保守用较高质量兜底（不阻断压缩）
  return { detail: 0, imageType: 'other', suggestedQuality: 80, minQuality: 55 };
}

/**
 * 智能压缩图片 - 本地画质驱动（无需 AI/云函数）。
 * canvas 分析图像高频细节，按内容类型自适应质量起点；
 * 无目标体积时直接用感知安全质量压缩（画质由内容决定，不由原图大小决定）；
 * 有目标体积时在 [minQuality, 100] 二分搜索满足体积的最高质量（不压破画质下限）。
 * @param {string} filePath - 图片路径
 * @param {number} targetSizeKB - 目标文件大小（KB），0 表示只保证画质
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<{path: string, quality: number, size: number, imageType: string}>} 压缩结果
 */
async function smartCompressImage(filePath, targetSizeKB = 0, onProgress = null) {
  try {
    const originalSize = await getFileSize(filePath);
    const originalSizeKB = originalSize / 1024;

    // 本地复杂度分析 → 质量起点与画质下限
    const analysis = await analyzeImageComplexity(filePath);
    const { imageType, suggestedQuality, minQuality } = analysis;

    // 原图已小于目标体积，直接返回（仍带类型信息）
    if (targetSizeKB > 0 && originalSizeKB <= targetSizeKB) {
      return { path: filePath, quality: 100, size: originalSize, imageType };
    }

    // 无目标体积：直接用感知安全质量压缩（不再用"原图大小比例"拍脑袋目标）
    if (targetSizeKB === 0) {
      const compressedPath = await compressImage(filePath, suggestedQuality);
      const compressedSize = await getFileSize(compressedPath);
      return { path: compressedPath, quality: suggestedQuality, size: compressedSize, imageType };
    }

    // 有目标体积：二分搜索 [minQuality, 100] 找满足体积的最高质量
    let lo = minQuality;
    let hi = 100;
    let bestResult = null;
    const maxIterations = 10;

    for (let i = 0; i < maxIterations && lo <= hi; i++) {
      const quality = Math.floor((lo + hi) / 2);
      if (onProgress) onProgress(quality, i + 1);

      const compressedPath = await compressImage(filePath, quality);
      const compressedSize = await getFileSize(compressedPath);
      const compressedSizeKB = compressedSize / 1024;

      if (compressedSizeKB <= targetSizeKB) {
        bestResult = { path: compressedPath, quality, size: compressedSize };
        lo = quality + 1; // 满足体积，尝试更高质量
      } else {
        hi = quality - 1; // 超体积，降质量
      }
    }

    // 搜索未果（minQuality 仍超目标体积）→ 取 minQuality 兜底，至少保证画质下限
    if (!bestResult) {
      const compressedPath = await compressImage(filePath, minQuality);
      const compressedSize = await getFileSize(compressedPath);
      bestResult = { path: compressedPath, quality: minQuality, size: compressedSize };
    }

    return { ...bestResult, imageType };
  } catch (err) {
    throw err;
  }
}

/**
 * 获取图片信息
 * @param {string} filePath - 图片路径
 * @returns {Promise<object>} 图片信息
 */
function getImageInfo(filePath) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: filePath,
      success: (res) => {
        resolve(res);
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

/**
 * 使用Canvas裁剪图片
 * @param {string} filePath - 图片路径
 * @param {number} x - 裁剪起始x坐标
 * @param {number} y - 裁剪起始y坐标
 * @param {number} width - 裁剪宽度
 * @param {number} height - 裁剪高度
 * @returns {Promise<string>} 裁剪后的图片路径
 */
async function cropImage(filePath, x, y, width, height) {
  return new Promise((resolve, reject) => {
    // 获取图片信息
    getImageInfo(filePath).then((info) => {
      const { width: imgWidth, height: imgHeight, path } = info;

      // 计算实际裁剪坐标（支持百分比）
      const actualX = x < 1 ? x * imgWidth : x;
      const actualY = y < 1 ? y * imgHeight : y;
      const actualWidth = width < 1 ? width * imgWidth : width;
      const actualHeight = height < 1 ? height * imgHeight : height;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: actualWidth,
        height: actualHeight
      });

      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();

      image.onload = () => {
        // 绘制裁剪后的图片
        ctx.drawImage(
          image,
          actualX, actualY, actualWidth, actualHeight,
          0, 0, actualWidth, actualHeight
        );

        // 导出图片
        wx.canvasToTempFilePath({
          canvas: canvas,
          success: (res) => {
            resolve(res.tempFilePath);
          },
          fail: (err) => {
            reject(err);
          }
        });
      };

      image.onerror = (err) => {
        reject(err);
      };

      image.src = path;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 转换图片格式
 * @param {string} filePath - 图片路径
 * @param {string} format - 目标格式 'jpg' | 'png' | 'webp'
 * @returns {Promise<string>} 转换后的图片路径
 */
async function convertImageFormat(filePath, format = 'jpg') {
  return new Promise((resolve, reject) => {
    // 获取系统信息，检查基础库版本
    const systemInfo = wx.getSystemInfoSync();
    const SDKVersion = systemInfo.SDKVersion;

    // 确定最终使用的格式
    let targetFormat = format;
    let showToastFlag = false;

    // 检查格式支持
    if (format === 'webp') {
      // WebP 需要基础库 2.11.0 以上
      const version = SDKVersion.split('.').map(Number);
      if (version[0] < 2 || (version[0] === 2 && version[1] < 11)) {
        targetFormat = 'png';
        showToastFlag = true;
      }
    } else if (format === 'bmp') {
      // BMP 格式不支持，回退到 JPG
      targetFormat = 'jpg';
      showToastFlag = true;
    }

    // 获取图片信息
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: width,
        height: height
      });

      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();

      image.onload = () => {
        // 绘制图片
        ctx.drawImage(image, 0, 0, width, height);

        // 导出指定格式的图片
        wx.canvasToTempFilePath({
          canvas: canvas,
          fileType: targetFormat,
          quality: targetFormat === 'jpg' ? 0.92 : 1, // JPG 使用高质量
          success: (res) => {
            // 如果格式回退了，显示提示
            if (showToastFlag && targetFormat !== format) {
              wx.showToast({
                title: format.toUpperCase() + '格式不支持，已转换为' + targetFormat.toUpperCase(),
                icon: 'none',
                duration: 2000
              });
            }

            // 将临时文件复制到用户数据目录，确保有正确的扩展名
            const fs = wx.getFileSystemManager();
            const timestamp = Date.now();
            const newFileName = `img_${timestamp}.${targetFormat}`;
            const newFilePath = `${wx.env.USER_DATA_PATH}/${newFileName}`;

            try {
              // 复制文件到新路径，使用正确的扩展名
              fs.copyFileSync(res.tempFilePath, newFilePath);

              // 验证文件是否成功复制
              try {
                const stats = fs.statSync(newFilePath);
              } catch (err) {
                console.error('无法访问新文件:', err);
              }

              // 删除临时文件
              try {
                fs.unlinkSync(res.tempFilePath);
              } catch (e) {
                console.warn('删除临时文件失败:', e);
              }

              resolve(newFilePath);
            } catch (err) {
              // 如果复制失败，返回原始临时路径
              console.error('文件复制失败，返回临时路径:', err);
              console.warn('临时文件路径:', res.tempFilePath);
              resolve(res.tempFilePath);
            }
          },
          fail: (err) => {
            console.error('canvasToTempFilePath 失败:', err);
            // 如果转换失败，尝试使用 PNG
            if (targetFormat !== 'png') {
              wx.canvasToTempFilePath({
                canvas: canvas,
                fileType: 'png',
                quality: 1,
                success: (res) => {
                  wx.showToast({
                    title: targetFormat.toUpperCase() + '格式不支持，已转换为PNG',
                    icon: 'none',
                    duration: 2000
                  });

                  // 同样处理PNG格式的文件名
                  const fs = wx.getFileSystemManager();
                  const timestamp = Date.now();
                  const newFileName = `img_${timestamp}.png`;
                  const newFilePath = `${wx.env.USER_DATA_PATH}/${newFileName}`;

                  try {
                    fs.copyFileSync(res.tempFilePath, newFilePath);
                    try {
                      fs.unlinkSync(res.tempFilePath);
                    } catch (e) {
                      // 忽略删除失败
                    }
                    resolve(newFilePath);
                  } catch (err2) {
                    resolve(res.tempFilePath);
                  }
                },
                fail: (err2) => {
                  reject(err2);
                }
              });
            } else {
              reject(err);
            }
          }
        });
      };

      image.onerror = (err) => {
        reject(err);
      };

      image.src = path;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 获取文件大小（格式化）
 * @param {number} size - 文件大小（字节）
 * @returns {string} 格式化后的文件大小
 */
function formatFileSize(size) {
  if (size < 1024) {
    return size + ' B';
  } else if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2) + ' KB';
  } else {
    return (size / (1024 * 1024)).toFixed(2) + ' MB';
  }
}

/**
 * 保存图片到相册
 * @param {string} filePath - 图片路径
 * @returns {Promise<boolean>} 是否保存成功
 */
function saveImageToPhotosAlbum(filePath) {
  return new Promise((resolve, reject) => {
    // 获取文件路径信息
    const fs = wx.getFileSystemManager();

    try {
      // 读取文件信息，验证文件是否存在
      const stats = fs.statSync(filePath);
    } catch (err) {
      console.error('文件不存在或无法访问:', filePath, err);
      reject(err);
      return;
    }

    // 先请求授权
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.writePhotosAlbum']) {
          // 已经授权，直接保存
          saveFile();
        } else if (res.authSetting['scope.writePhotosAlbum'] === false) {
          // 用户之前拒绝过，引导用户打开设置
          wx.showModal({
            title: '提示',
            content: '需要您授权保存相册权限，请在设置中开启',
            confirmText: '去设置',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting({
                  success: (settingRes) => {
                    if (settingRes.authSetting['scope.writePhotosAlbum']) {
                      saveFile();
                    } else {
                      reject(new Error('用户未授权'));
                    }
                  }
                });
              } else {
                reject(new Error('用户取消授权'));
              }
            }
          });
        } else {
          // 首次请求授权
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: () => {
              saveFile();
            },
            fail: () => {
              wx.showModal({
                title: '提示',
                content: '需要您授权保存相册权限',
                confirmText: '去设置',
                success: (modalRes) => {
                  if (modalRes.confirm) {
                    wx.openSetting({
                      success: (settingRes) => {
                        if (settingRes.authSetting['scope.writePhotosAlbum']) {
                          saveFile();
                        } else {
                          reject(new Error('用户未授权'));
                        }
                      }
                    });
                  } else {
                    reject(new Error('用户取消授权'));
                  }
                }
              });
            }
          });
        }
      },
      fail: (err) => {
        console.error('获取授权设置失败:', err);
        reject(err);
      }
    });

    // 实际保存文件的函数
    function saveFile() {
      wx.saveImageToPhotosAlbum({
        filePath: filePath,
        success: () => {
          // 从文件路径中提取格式信息
          const formatMatch = filePath.match(/\.(\w+)$/);
          const format = formatMatch ? formatMatch[1].toUpperCase() : '图片';

          wx.showToast({
            title: `${format}格式已保存`,
            icon: 'success',
            duration: 2000
          });
          resolve(true);
        },
        fail: (err) => {
          console.error('保存到相册失败:', err);
          wx.showToast({
            title: '保存失败: ' + (err.errMsg || '未知错误'),
            icon: 'none',
            duration: 2000
          });
          reject(err);
        }
      });
    }
  });
}

/**
 * 获取文件实际大小
 * @param {string} filePath - 文件路径
 * @returns {Promise<number>} 文件大小（字节）
 */
function getFileSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath: filePath,
      success: (res) => {
        resolve(res.size);
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

/**
 * 选择图片
 * @param {number} count - 可选择图片数量
 * @param {Array<string>} sizeType - 图片尺寸类型
 * @param {Array<string>} sourceType - 图片来源
 * @returns {Promise<Array>} 选择的图片列表
 */
function chooseImage(count = 1, sizeType = ['original', 'compressed'], sourceType = ['album', 'camera']) {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: count,
      sizeType: sizeType,
      sourceType: sourceType,
      success: async (res) => {
        // 内容安全：逐张过检，剔除违规图（违规内部已弹标准化提示，不暴露原因）
        // 懒 require 规避与 content-check 的循环依赖
        const { guardImage } = require('./content-check');
        const paths = res.tempFilePaths || [];
        const safePaths = [];
        for (let i = 0; i < paths.length; i++) {
          if (await guardImage(paths[i])) {
            safePaths.push(paths[i]);
          }
        }
        resolve(safePaths);
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

/**
 * 添加文字水印
 * @param {string} filePath - 图片路径
 * @param {string} text - 水印文字
 * @param {object} options - 水印选项
 * @returns {Promise<string>} 处理后的图片路径
 */
async function addTextWatermark(filePath, text, options = {}) {
  const {
    fontSize = 24,
    fontColor = '#FFFFFF',
    opacity = 0.7,
    position = 9 // 1-9位置
  } = options;

  return new Promise((resolve, reject) => {
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: width,
        height: height
      });

      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();

      image.onload = () => {
        // 绘制原图
        ctx.drawImage(image, 0, 0, width, height);

        // 设置文字样式
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = fontColor;
        ctx.globalAlpha = opacity;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        // 计算水印位置
        const padding = 20;
        const textWidth = ctx.measureText(text).width;
        const textHeight = fontSize;

        let x, y;

        // 位置映射（1-9宫格）
        const positions = {
          1: { x: padding + textWidth / 2, y: padding + textHeight / 2 },
          2: { x: width / 2, y: padding + textHeight / 2 },
          3: { x: width - padding - textWidth / 2, y: padding + textHeight / 2 },
          4: { x: padding + textWidth / 2, y: height / 2 },
          5: { x: width / 2, y: height / 2 },
          6: { x: width - padding - textWidth / 2, y: height / 2 },
          7: { x: padding + textWidth / 2, y: height - padding - textHeight / 2 },
          8: { x: width / 2, y: height - padding - textHeight / 2 },
          9: { x: width - padding - textWidth / 2, y: height - padding - textHeight / 2 }
        };

        const pos = positions[position] || positions[9];
        x = pos.x;
        y = pos.y;

        // 绘制水印文字
        ctx.fillText(text, x, y);

        // 导出图片
        wx.canvasToTempFilePath({
          canvas: canvas,
          success: (res) => {
            resolve(res.tempFilePath);
          },
          fail: (err) => {
            reject(err);
          }
        });
      };

      image.onerror = (err) => {
        reject(err);
      };

      image.src = path;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 添加图片水印
 * @param {string} filePath - 原图路径
 * @param {string} watermarkPath - 水印图片路径
 * @param {object} options - 水印选项
 * @returns {Promise<string>} 处理后的图片路径
 */
async function addImageWatermark(filePath, watermarkPath, options = {}) {
  const {
    scale = 0.2,
    opacity = 0.7,
    position = 9
  } = options;

  return new Promise((resolve, reject) => {
    Promise.all([
      getImageInfo(filePath),
      getImageInfo(watermarkPath)
    ]).then(([mainInfo, watermarkInfo]) => {
      const { width: mainWidth, height: mainHeight, path: mainPath } = mainInfo;
      const { width: wmWidth, height: wmHeight, path: wmPath } = watermarkInfo;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: mainWidth,
        height: mainHeight
      });

      const ctx = canvas.getContext('2d');

      // 加载两张图片
      const mainImage = canvas.createImage();
      const watermarkImage = canvas.createImage();

      let imagesLoaded = 0;

      const onImageLoad = () => {
        imagesLoaded++;

        if (imagesLoaded === 2) {
          // 绘制原图
          ctx.drawImage(mainImage, 0, 0, mainWidth, mainHeight);

          // 计算水印尺寸
          const wmScaledWidth = wmWidth * scale;
          const wmScaledHeight = wmHeight * scale;
          const padding = 20;

          // 计算水印位置
          let x, y;

          const positions = {
            1: { x: padding, y: padding },
            2: { x: (mainWidth - wmScaledWidth) / 2, y: padding },
            3: { x: mainWidth - wmScaledWidth - padding, y: padding },
            4: { x: padding, y: (mainHeight - wmScaledHeight) / 2 },
            5: { x: (mainWidth - wmScaledWidth) / 2, y: (mainHeight - wmScaledHeight) / 2 },
            6: { x: mainWidth - wmScaledWidth - padding, y: (mainHeight - wmScaledHeight) / 2 },
            7: { x: padding, y: mainHeight - wmScaledHeight - padding },
            8: { x: (mainWidth - wmScaledWidth) / 2, y: mainHeight - wmScaledHeight - padding },
            9: { x: mainWidth - wmScaledWidth - padding, y: mainHeight - wmScaledHeight - padding }
          };

          const pos = positions[position] || positions[9];
          x = pos.x;
          y = pos.y;

          // 绘制水印
          ctx.globalAlpha = opacity;
          ctx.drawImage(watermarkImage, x, y, wmScaledWidth, wmScaledHeight);

          // 导出图片
          wx.canvasToTempFilePath({
            canvas: canvas,
            success: (res) => {
              resolve(res.tempFilePath);
            },
            fail: (err) => {
              reject(err);
            }
          });
        }
      };

      mainImage.onload = onImageLoad;
      watermarkImage.onload = onImageLoad;

      mainImage.onerror = (err) => {
        reject(err);
      };

      watermarkImage.onerror = (err) => {
        reject(err);
      };

      mainImage.src = mainPath;
      watermarkImage.src = wmPath;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 添加文字水印（多位置）
 * @param {string} filePath - 图片路径
 * @param {string} text - 水印文字
 * @param {object} options - 水印选项
 * @returns {Promise<string>} 处理后的图片路径
 */
async function addTextWatermarkMulti(filePath, text, options = {}) {
  const {
    fontSize = 24,
    fontColor = '#FFFFFF',
    opacity = 0.7,
    positions = [1, 9] // 多位置数组
  } = options;

  return new Promise((resolve, reject) => {
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: width,
        height: height
      });

      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();

      image.onload = () => {
        // 绘制原图
        ctx.drawImage(image, 0, 0, width, height);

        // 设置文字样式
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = fontColor;
        ctx.globalAlpha = opacity;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        // 位置映射
        const padding = 20;
        const textWidth = ctx.measureText(text).width;
        const textHeight = fontSize;

        const positionsMap = {
          1: { x: padding + textWidth / 2, y: padding + textHeight / 2 },
          2: { x: width / 2, y: padding + textHeight / 2 },
          3: { x: width - padding - textWidth / 2, y: padding + textHeight / 2 },
          4: { x: padding + textWidth / 2, y: height / 2 },
          5: { x: width / 2, y: height / 2 },
          6: { x: width - padding - textWidth / 2, y: height / 2 },
          7: { x: padding + textWidth / 2, y: height - padding - textHeight / 2 },
          8: { x: width / 2, y: height - padding - textHeight / 2 },
          9: { x: width - padding - textWidth / 2, y: height - padding - textHeight / 2 }
        };

        // 在每个位置绘制水印
        positions.forEach(pos => {
          const position = positionsMap[pos];
          if (position) {
            ctx.fillText(text, position.x, position.y);
          }
        });

        // 导出图片
        wx.canvasToTempFilePath({
          canvas: canvas,
          success: (res) => {
            resolve(res.tempFilePath);
          },
          fail: (err) => {
            reject(err);
          }
        });
      };

      image.onerror = (err) => {
        reject(err);
      };

      image.src = path;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 添加平铺文字水印
 * @param {string} filePath - 图片路径
 * @param {string} text - 水印文字
 * @param {object} options - 水印选项
 * @returns {Promise<string>} 处理后的图片路径
 */
async function addTiledTextWatermark(filePath, text, options = {}) {
  const {
    fontSize = 24,
    fontColor = '#FFFFFF',
    opacity = 0.3,
    spacing = 150,
    rotation = -30
  } = options;

  return new Promise((resolve, reject) => {
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: width,
        height: height
      });

      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();

      image.onload = () => {
        // 绘制原图
        ctx.drawImage(image, 0, 0, width, height);

        // 设置文字样式
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = fontColor;
        ctx.globalAlpha = opacity;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        // 计算行列数（需要覆盖对角线）
        const diagonal = Math.sqrt(width * width + height * height);
        const cols = Math.ceil(diagonal / spacing) + 2;
        const rows = Math.ceil(diagonal / spacing) + 2;

        // 旋转角度转换为弧度
        const rotationRad = rotation * Math.PI / 180;

        // 保存当前状态
        ctx.save();

        // 平铺水印
        for (let row = -1; row < rows; row++) {
          for (let col = -1; col < cols; col++) {
            const x = col * spacing;
            const y = row * spacing;

            // 先平移到原点，旋转，再平移到目标位置
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotationRad);
            ctx.fillText(text, 0, 0);
            ctx.restore();
          }
        }

        // 恢复状态
        ctx.restore();

        // 导出图片
        wx.canvasToTempFilePath({
          canvas: canvas,
          success: (res) => {
            resolve(res.tempFilePath);
          },
          fail: (err) => {
            reject(err);
          }
        });
      };

      image.onerror = (err) => {
        reject(err);
      };

      image.src = path;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 添加图片水印（多位置）
 * @param {string} filePath - 原图路径
 * @param {string} watermarkPath - 水印图片路径
 * @param {object} options - 水印选项
 * @returns {Promise<string>} 处理后的图片路径
 */
async function addImageWatermarkMulti(filePath, watermarkPath, options = {}) {
  const {
    scale = 0.2,
    opacity = 0.7,
    positions = [1, 9]
  } = options;

  return new Promise((resolve, reject) => {
    Promise.all([
      getImageInfo(filePath),
      getImageInfo(watermarkPath)
    ]).then(([mainInfo, watermarkInfo]) => {
      const { width: mainWidth, height: mainHeight, path: mainPath } = mainInfo;
      const { width: wmWidth, height: wmHeight, path: wmPath } = watermarkInfo;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: mainWidth,
        height: mainHeight
      });

      const ctx = canvas.getContext('2d');

      // 加载两张图片
      const mainImage = canvas.createImage();
      const watermarkImage = canvas.createImage();

      let imagesLoaded = 0;

      const onImageLoad = () => {
        imagesLoaded++;

        if (imagesLoaded === 2) {
          // 绘制原图
          ctx.drawImage(mainImage, 0, 0, mainWidth, mainHeight);

          // 计算水印尺寸
          const wmScaledWidth = wmWidth * scale;
          const wmScaledHeight = wmHeight * scale;
          const padding = 20;

          // 位置映射
          const positionsMap = {
            1: { x: padding, y: padding },
            2: { x: (mainWidth - wmScaledWidth) / 2, y: padding },
            3: { x: mainWidth - wmScaledWidth - padding, y: padding },
            4: { x: padding, y: (mainHeight - wmScaledHeight) / 2 },
            5: { x: (mainWidth - wmScaledWidth) / 2, y: (mainHeight - wmScaledHeight) / 2 },
            6: { x: mainWidth - wmScaledWidth - padding, y: (mainHeight - wmScaledHeight) / 2 },
            7: { x: padding, y: mainHeight - wmScaledHeight - padding },
            8: { x: (mainWidth - wmScaledWidth) / 2, y: mainHeight - wmScaledHeight - padding },
            9: { x: mainWidth - wmScaledWidth - padding, y: mainHeight - wmScaledHeight - padding }
          };

          // 在每个位置绘制水印
          ctx.globalAlpha = opacity;
          positions.forEach(pos => {
            const position = positionsMap[pos];
            if (position) {
              ctx.drawImage(watermarkImage, position.x, position.y, wmScaledWidth, wmScaledHeight);
            }
          });

          // 导出图片
          wx.canvasToTempFilePath({
            canvas: canvas,
            success: (res) => {
              resolve(res.tempFilePath);
            },
            fail: (err) => {
              reject(err);
            }
          });
        }
      };

      mainImage.onload = onImageLoad;
      watermarkImage.onload = onImageLoad;

      mainImage.onerror = (err) => {
        reject(err);
      };

      watermarkImage.onerror = (err) => {
        reject(err);
      };

      mainImage.src = mainPath;
      watermarkImage.src = wmPath;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 添加平铺图片水印
 * @param {string} filePath - 原图路径
 * @param {string} watermarkPath - 水印图片路径
 * @param {object} options - 水印选项
 * @returns {Promise<string>} 处理后的图片路径
 */
async function addTiledImageWatermark(filePath, watermarkPath, options = {}) {
  const {
    scale = 0.2,
    opacity = 0.3,
    spacing = 150,
    rotation = -30
  } = options;

  return new Promise((resolve, reject) => {
    Promise.all([
      getImageInfo(filePath),
      getImageInfo(watermarkPath)
    ]).then(([mainInfo, watermarkInfo]) => {
      const { width: mainWidth, height: mainHeight, path: mainPath } = mainInfo;
      const { width: wmWidth, height: wmHeight, path: wmPath } = watermarkInfo;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: mainWidth,
        height: mainHeight
      });

      const ctx = canvas.getContext('2d');

      // 加载两张图片
      const mainImage = canvas.createImage();
      const watermarkImage = canvas.createImage();

      let imagesLoaded = 0;

      const onImageLoad = () => {
        imagesLoaded++;

        if (imagesLoaded === 2) {
          // 绘制原图
          ctx.drawImage(mainImage, 0, 0, mainWidth, mainHeight);

          // 计算水印尺寸
          const wmScaledWidth = wmWidth * scale;
          const wmScaledHeight = wmHeight * scale;

          // 计算行列数（需要覆盖对角线）
          const diagonal = Math.sqrt(mainWidth * mainWidth + mainHeight * mainHeight);
          const cols = Math.ceil(diagonal / spacing) + 2;
          const rows = Math.ceil(diagonal / spacing) + 2;

          // 旋转角度转换为弧度
          const rotationRad = rotation * Math.PI / 180;

          // 设置透明度
          ctx.globalAlpha = opacity;

          // 平铺水印
          for (let row = -1; row < rows; row++) {
            for (let col = -1; col < cols; col++) {
              const x = col * spacing;
              const y = row * spacing;

              // 先平移到原点，旋转，再平移到目标位置
              ctx.save();
              ctx.translate(x, y);
              ctx.rotate(rotationRad);
              ctx.drawImage(
                watermarkImage,
                -wmScaledWidth / 2,
                -wmScaledHeight / 2,
                wmScaledWidth,
                wmScaledHeight
              );
              ctx.restore();
            }
          }

          // 导出图片
          wx.canvasToTempFilePath({
            canvas: canvas,
            success: (res) => {
              resolve(res.tempFilePath);
            },
            fail: (err) => {
              reject(err);
            }
          });
        }
      };

      mainImage.onload = onImageLoad;
      watermarkImage.onload = onImageLoad;

      mainImage.onerror = (err) => {
        reject(err);
      };

      watermarkImage.onerror = (err) => {
        reject(err);
      };

      mainImage.src = mainPath;
      watermarkImage.src = wmPath;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 应用手动调节（亮度、对比度等）
 * @param {string} filePath - 图片路径
 * @param {object} adjustments - 调节参数
 * @returns {Promise<string>} 处理后的图片路径
 */
async function applyAdjustments(filePath, adjustments = {}) {
  const {
    brightness = 100,
    contrast = 100,
    saturate = 100,
    blur = 0,
    hueRotate = 0
  } = adjustments;

  return new Promise((resolve, reject) => {
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: width,
        height: height
      });

      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();

      image.onload = () => {
        // 构建filter字符串
        const filters = [];
        filters.push(`brightness(${brightness}%)`);
        filters.push(`contrast(${contrast}%)`);
        filters.push(`saturate(${saturate}%)`);
        if (blur > 0) {
          filters.push(`blur(${blur}px)`);
        }
        if (hueRotate > 0) {
          filters.push(`hue-rotate(${hueRotate}deg)`);
        }

        ctx.filter = filters.join(' ');

        // 绘制图片
        ctx.drawImage(image, 0, 0, width, height);

        // 导出图片
        wx.canvasToTempFilePath({
          canvas: canvas,
          success: (res) => {
            resolve(res.tempFilePath);
          },
          fail: (err) => {
            reject(err);
          }
        });
      };

      image.onerror = (err) => {
        reject(err);
      };

      image.src = path;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 应用预设滤镜
 * @param {string} filePath - 图片路径
 * @param {string} filter - 滤镜字符串
 * @returns {Promise<string>} 处理后的图片路径
 */
async function applyPresetFilter(filePath, filter) {
  return new Promise((resolve, reject) => {
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: width,
        height: height
      });

      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();

      image.onload = () => {
        // 应用滤镜
        if (filter !== 'none') {
          ctx.filter = filter;
        }

        // 绘制图片
        ctx.drawImage(image, 0, 0, width, height);

        // 导出图片
        wx.canvasToTempFilePath({
          canvas: canvas,
          success: (res) => {
            resolve(res.tempFilePath);
          },
          fail: (err) => {
            reject(err);
          }
        });
      };

      image.onerror = (err) => {
        reject(err);
      };

      image.src = path;
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 拼接多张图片
 * @param {Array<string>} filePaths - 图片路径数组
 * @param {object} options - 拼接选项
 * @returns {Promise<string>} 拼接后的图片路径
 */
async function spliceImages(filePaths, options = {}) {
  const {
    mode = 'grid',        // horizontal, vertical, grid
    spacing = 10,
    cornerRadius = 0,
    backgroundColor = '#ffffff',
    backgroundImage = '',
    gridRows = 3,
    gridCols = 3
  } = options;

  return new Promise((resolve, reject) => {
    // 获取所有图片信息
    Promise.all(filePaths.map(path => getImageInfo(path))).then((imagesInfo) => {
      const count = imagesInfo.length;

      let canvasWidth, canvasHeight;
      let itemWidth, itemHeight;

      // 计算画布尺寸和单个图片尺寸
      if (mode === 'horizontal') {
        // 横向拼接
        const maxHeight = Math.max(...imagesInfo.map(info => info.height));
        itemHeight = maxHeight;
        itemWidth = imagesInfo.reduce((sum, info) => {
          const ratio = info.width / info.height;
          return sum + maxHeight * ratio;
        }, 0);

        canvasWidth = itemWidth + (count - 1) * spacing;
        canvasHeight = maxHeight;
      } else if (mode === 'vertical') {
        // 纵向拼接
        const maxWidth = Math.max(...imagesInfo.map(info => info.width));
        itemWidth = maxWidth;
        itemHeight = imagesInfo.reduce((sum, info) => {
          const ratio = info.height / info.width;
          return sum + maxWidth * ratio;
        }, 0);

        canvasWidth = maxWidth;
        canvasHeight = itemHeight + (count - 1) * spacing;
      } else {
        // 网格拼接
        const cols = Math.min(gridCols, count);
        const rows = Math.ceil(count / gridCols);

        // 使用第一张图片的宽高比作为参考
        const firstImage = imagesInfo[0];
        const targetItemWidth = 300;
        const targetItemHeight = targetItemWidth * (firstImage.height / firstImage.width);

        canvasWidth = targetItemWidth * cols + spacing * (cols - 1);
        canvasHeight = targetItemHeight * rows + spacing * (rows - 1);

        itemWidth = targetItemWidth;
        itemHeight = targetItemHeight;
      }

      // 创建离屏canvas
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: canvasWidth,
        height: canvasHeight
      });

      const ctx = canvas.getContext('2d');

      // 绘制背景
      if (backgroundImage) {
        // 如果有背景图片，先加载背景图片
        const bgImage = canvas.createImage();
        bgImage.onload = () => {
          // 绘制背景图片，平铺覆盖整个画布
          ctx.drawImage(bgImage, 0, 0, canvasWidth, canvasHeight);

          // 然后加载其他图片
          loadAndSpliceImages();
        };
        bgImage.onerror = () => {
          // 如果背景图片加载失败，使用背景色
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          loadAndSpliceImages();
        };
        bgImage.src = backgroundImage;
      } else {
        // 没有背景图片，直接使用背景色
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        loadAndSpliceImages();
      }

      // 加载所有图片并拼接
      function loadAndSpliceImages() {
        const images = imagesInfo.map(() => canvas.createImage());
        let loadedCount = 0;

        images.forEach((image, index) => {
          image.onload = () => {
            loadedCount++;

            if (loadedCount === count) {
              // 所有图片加载完成，开始拼接
              let currentX = 0;
              let currentY = 0;

              images.forEach((img, idx) => {
                let x, y, w, h;

                if (mode === 'horizontal') {
                  // 横向拼接
                  const ratio = imagesInfo[idx].width / imagesInfo[idx].height;
                  h = itemHeight;
                  w = itemHeight * ratio;
                  x = currentX;
                  y = 0;
                  currentX += w + spacing;
                } else if (mode === 'vertical') {
                  // 纵向拼接
                  const ratio = imagesInfo[idx].height / imagesInfo[idx].width;
                  w = itemWidth;
                  h = itemWidth * ratio;
                  x = 0;
                  y = currentY;
                  currentY += h + spacing;
                } else {
                  // 网格拼接
                  const col = idx % gridCols;
                  const row = Math.floor(idx / gridCols);

                  w = itemWidth;
                  h = itemHeight;
                  x = col * (itemWidth + spacing);
                  y = row * (itemHeight + spacing);
                }

                // 绘制圆角（如果有）
                if (cornerRadius > 0) {
                  ctx.save();
                  roundRect(ctx, x, y, w, h, cornerRadius);
                  ctx.clip();
                  ctx.drawImage(img, x, y, w, h);
                  ctx.restore();
                } else {
                  ctx.drawImage(img, x, y, w, h);
                }
              });

              // 导出图片
              wx.canvasToTempFilePath({
                canvas: canvas,
                success: (res) => {
                  resolve(res.tempFilePath);
                },
                fail: (err) => {
                  reject(err);
                }
              });
            }
          };

          image.onerror = (err) => {
            reject(err);
          };

          image.src = imagesInfo[index].path;
        });
      }
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * 绘制圆角矩形路径
 * @param {object} ctx - Canvas上下文
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {number} r - 圆角半径
 */
function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 生成内容安全检测用的小图（最长边缩到 maxEdge，JPEG quality）
 * imgSecCheck 限制 ≤1MB / ≤750×1334px，故送检前必须缩图。
 * @param {string} filePath - 原图临时路径
 * @param {number} maxEdge - 最长边像素上限（默认 600）
 * @param {number} quality - JPEG 质量 0-1（默认 0.6）
 * @returns {Promise<string>} 缩略图临时路径（失败回退到 compressImage 或原路径）
 */
function makeCheckThumb(filePath, maxEdge = 600, quality = 0.6) {
  return new Promise((resolve) => {
    getImageInfo(filePath).then((info) => {
      const { width, height, path } = info;
      const longest = Math.max(width, height);
      const scale = longest > maxEdge ? maxEdge / longest : 1;
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));

      const canvas = wx.createOffscreenCanvas({ type: '2d', width: targetWidth, height: targetHeight });
      const ctx = canvas.getContext('2d');
      const image = canvas.createImage();

      image.onload = () => {
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
        wx.canvasToTempFilePath({
          canvas: canvas,
          fileType: 'jpg',
          quality: quality,
          success: (res) => resolve(res.tempFilePath),
          fail: (err) => {
            console.warn('[makeCheckThumb] canvasToTempFilePath 失败，回退 compressImage', err);
            _fallbackCompress(filePath, quality).then(resolve).catch(() => resolve(filePath));
          }
        });
      };

      image.onerror = () => {
        console.warn('[makeCheckThumb] canvas 加载图片失败，回退 compressImage');
        _fallbackCompress(filePath, quality).then(resolve).catch(() => resolve(filePath));
      };

      image.src = path;
    }).catch(() => {
      _fallbackCompress(filePath, quality).then(resolve).catch(() => resolve(filePath));
    });
  });
}

// 回退：仅质量压缩（不缩尺寸），尽力保证 ≤1MB
function _fallbackCompress(filePath, quality) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: filePath,
      quality: Math.round((quality || 0.6) * 100),
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    });
  });
}

module.exports = {
  compressImage,
  smartCompressImage,
  analyzeImageComplexity,
  getImageInfo,
  cropImage,
  convertImageFormat,
  formatFileSize,
  saveImageToPhotosAlbum,
  chooseImage,
  getFileSize,
  addTextWatermark,
  addImageWatermark,
  addTextWatermarkMulti,
  addTiledTextWatermark,
  addImageWatermarkMulti,
  addTiledImageWatermark,
  applyAdjustments,
  applyPresetFilter,
  spliceImages,
  makeCheckThumb
};
