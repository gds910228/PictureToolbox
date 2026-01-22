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
 * 智能压缩图片 - 自动寻找最佳质量
 * @param {string} filePath - 图片路径
 * @param {number} targetSizeKB - 目标文件大小（KB），如果为0则只保证画质
 * @param {Function} onProgress - 进度回调
 * @param {object} aiAnalysis - AI分析结果（可选）
 * @returns {Promise<{path: string, quality: number, size: number}>} 压缩结果
 */
async function smartCompressImage(filePath, targetSizeKB = 0, onProgress = null, aiAnalysis = null) {
  try {
    // 获取原图大小
    const originalSize = await getFileSize(filePath);
    const originalSizeKB = originalSize / 1024;

    // 如果原图已经小于目标大小，直接返回
    if (targetSizeKB > 0 && originalSizeKB <= targetSizeKB) {
      return {
        path: filePath,
        quality: 100,
        size: originalSize
      };
    }

    // 根据AI分析结果确定压缩策略
    let strategy = 'balanced'; // 默认平衡策略
    let minQuality = 10;
    let maxQuality = 100;

    if (aiAnalysis && aiAnalysis.recommendation) {
      strategy = aiAnalysis.recommendation.strategy || 'balanced';

      // 根据策略调整搜索范围
      if (strategy === 'quality-priority') {
        // 质量优先：保持较高质量
        minQuality = Math.max(60, aiAnalysis.recommendation.suggestedQuality - 15);
        maxQuality = Math.min(100, aiAnalysis.recommendation.suggestedQuality + 10);
      } else if (strategy === 'size-priority') {
        // 大小优先：可以降低质量
        minQuality = 10;
        maxQuality = Math.min(80, aiAnalysis.recommendation.suggestedQuality);
      } else {
        // 平衡策略
        minQuality = Math.max(50, aiAnalysis.recommendation.suggestedQuality - 20);
        maxQuality = Math.min(95, aiAnalysis.recommendation.suggestedQuality + 15);
      }
    }

    let bestResult = null;

    // 二分查找最佳质量
    const maxIterations = targetSizeKB > 0 ? 10 : 7; // 有目标大小时多尝试几次

    for (let i = 0; i < maxIterations; i++) {
      const quality = Math.floor((minQuality + maxQuality) / 2);

      if (onProgress) {
        onProgress(quality, i + 1);
      }

      // 压缩图片
      const compressedPath = await compressImage(filePath, quality);
      const compressedSize = await getFileSize(compressedPath);
      const compressedSizeKB = compressedSize / 1024;

      // 检查是否满足目标大小
      if (targetSizeKB === 0) {
        // 如果没有目标大小，根据策略选择
        if (strategy === 'quality-priority') {
          // 质量优先：选择能保持80%以上大小的质量
          if (compressedSizeKB > originalSizeKB * 0.8) {
            bestResult = { path: compressedPath, quality, size: compressedSize };
            minQuality = quality + 1; // 继续尝试更高质量
          } else {
            maxQuality = quality - 1;
          }
        } else if (strategy === 'size-priority') {
          // 大小优先：尽可能压缩
          if (compressedSizeKB < originalSizeKB * 0.3) {
            bestResult = { path: compressedPath, quality, size: compressedSize };
            minQuality = quality + 1;
          } else {
            bestResult = { path: compressedPath, quality, size: compressedSize };
            maxQuality = quality - 1;
          }
        } else {
          // 平衡策略：压缩到50-70%
          if (compressedSizeKB < originalSizeKB * 0.5) {
            bestResult = { path: compressedPath, quality, size: compressedSize };
            minQuality = quality + 1;
          } else if (compressedSizeKB > originalSizeKB * 0.7) {
            maxQuality = quality - 1;
          } else {
            bestResult = { path: compressedPath, quality, size: compressedSize };
            maxQuality = quality - 1;
          }
        }
      } else {
        // 有目标大小
        if (compressedSizeKB <= targetSizeKB) {
          // 满足目标大小，尝试提高质量
          bestResult = { path: compressedPath, quality, size: compressedSize };
          minQuality = quality + 1;
        } else {
          // 文件太大，降低质量
          maxQuality = quality - 1;
        }
      }

      // 如果质量范围太小，退出
      if (maxQuality < minQuality) {
        break;
      }
    }

    // 如果没有找到合适的压缩结果，使用AI建议的质量或默认质量
    if (!bestResult) {
      const fallbackQuality = (aiAnalysis && aiAnalysis.recommendation)
        ? aiAnalysis.recommendation.suggestedQuality
        : 80;

      const defaultPath = await compressImage(filePath, fallbackQuality);
      const defaultSize = await getFileSize(defaultPath);
      bestResult = { path: defaultPath, quality: fallbackQuality, size: defaultSize };
    }

    return bestResult;
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
                console.log('文件复制成功:', newFilePath);
                console.log('新文件大小:', stats.size, '字节');
              } catch (err) {
                console.error('无法访问新文件:', err);
              }

              // 删除临时文件
              try {
                fs.unlinkSync(res.tempFilePath);
                console.log('临时文件已删除:', res.tempFilePath);
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
      console.log('准备保存文件:', filePath);
      console.log('文件大小:', stats.size, '字节');
    } catch (err) {
      console.error('文件不存在或无法访问:', filePath, err);
    }

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
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '提示',
            content: '需要您授权保存相册权限',
            showCancel: false,
            success: (res) => {
              wx.openSetting();
            }
          });
        } else {
          wx.showToast({
            title: '保存失败: ' + (err.errMsg || '未知错误'),
            icon: 'none',
            duration: 2000
          });
        }
        reject(err);
      }
    });
  });
}

/**
 * 获取文件实际大小
 * @param {string} filePath - 文件路径
 * @returns {Promise<number>} 文件大小（字节）
 */
function getFileSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileInfo({
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
      success: (res) => {
        resolve(res.tempFilePaths);
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
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // 加载所有图片
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

module.exports = {
  compressImage,
  smartCompressImage,
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
  spliceImages
};
