// cloudfunctions/imgToPdf/index.js
// 多图合成 PDF 云函数 - 基于 pdf-lib (MIT开源协议，完全免费)
//
// 入参:
//   fileIDs: string[]     - 已上传到云存储的图片 fileID 列表（按文件名排序后）
//   pageSize: 'A4' | '16:9' | '1:1'
//   margin:   number      - 页边距 (pt)，默认 36 (0.5 英寸)
//   filename: string      - 生成的 PDF 文件名（不含扩展名）
// 返回:
//   { success: boolean, fileID?: string, pageCount?: number, error?: string }

const cloud = require('wx-server-sdk');
const { PDFDocument } = require('pdf-lib');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 页面尺寸（单位 pt，1 英寸 = 72pt）
const PAGE_SIZES = {
  'A4':   { width: 595.28, height: 841.89 },   // A4 纵向
  '16:9': { width: 960,    height: 540 },      // 16:9 横向
  '1:1':  { width: 600,    height: 600 }       // 正方形
};

exports.main = async (event, context) => {
  const startTime = Date.now();
  const {
    fileIDs = [],
    pageSize = 'A4',
    margin = 36,
    filename = 'images'
  } = event;

  console.log('[imgToPdf] 开始处理', {
    count: fileIDs.length,
    pageSize,
    margin
  });

  if (!Array.isArray(fileIDs) || fileIDs.length === 0) {
    return { success: false, error: '缺少图片列表' };
  }

  if (fileIDs.length > 30) {
    return { success: false, error: '单次最多支持 30 张图片' };
  }

  const size = PAGE_SIZES[pageSize] || PAGE_SIZES['A4'];
  const pageWidth = size.width;
  const pageHeight = size.height;
  const safeMargin = Math.max(0, Math.min(Number(margin) || 0, Math.min(pageWidth, pageHeight) / 4));

  try {
    // 1. 创建 PDF 文档
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(filename);
    pdfDoc.setProducer('NoWatermarkCowHorse - imgToPdf');
    pdfDoc.setCreator('pdf-lib');
    pdfDoc.setCreationDate(new Date());

    // 2. 并发下载所有图片（限制并发为 5）
    const buffers = await downloadInBatches(fileIDs, 5);

    // 3. 逐张嵌入图片到独立页面
    let okPages = 0;
    for (let i = 0; i < buffers.length; i++) {
      const buf = buffers[i];
      if (!buf) {
        console.warn(`[imgToPdf] 第 ${i + 1} 张图片下载失败，跳过`);
        continue;
      }

      try {
        // 自动识别 JPG / PNG（pdf-lib 内置支持这两种）
        const img = await embedImage(pdfDoc, buf);
        if (!img) {
          console.warn(`[imgToPdf] 第 ${i + 1} 张图片格式不支持，跳过`);
          continue;
        }

        const page = pdfDoc.addPage([pageWidth, pageHeight]);

        // 等比缩放到 (pageWidth - 2*margin) x (pageHeight - 2*margin)
        const maxW = pageWidth - safeMargin * 2;
        const maxH = pageHeight - safeMargin * 2;
        const scale = Math.min(maxW / img.width, maxH / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const x = (pageWidth - drawW) / 2;
        const y = (pageHeight - drawH) / 2;

        page.drawImage(img, { x, y, width: drawW, height: drawH });
        okPages++;
      } catch (e) {
        console.error(`[imgToPdf] 嵌入第 ${i + 1} 张图片失败`, e.message);
      }
    }

    if (okPages === 0) {
      return { success: false, error: '没有任何图片成功合成' };
    }

    // 4. 序列化 PDF
    const pdfBytes = await pdfDoc.save();
    console.log('[imgToPdf] PDF 生成完成，大小', pdfBytes.length, 'bytes');

    // 5. 上传到云存储
    const safeName = sanitize(filename) || 'images';
    const cloudPath = `pdf/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}.pdf`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: Buffer.from(pdfBytes)
    });

    const elapsed = Date.now() - startTime;
    console.log('[imgToPdf] 上传完成', uploadRes.fileID, `${elapsed}ms`);

    return {
      success: true,
      fileID: uploadRes.fileID,
      pageCount: okPages,
      totalCount: fileIDs.length,
      pdfSize: pdfBytes.length,
      pageSize,
      elapsedMs: elapsed
    };
  } catch (err) {
    console.error('[imgToPdf] 处理失败', err);
    return {
      success: false,
      error: err.message || '生成 PDF 失败'
    };
  }
};

/**
 * 嵌入图片，自动识别 JPG / PNG。
 * 不支持的格式返回 null，由调用方跳过。
 */
async function embedImage(pdfDoc, buffer) {
  // PNG 头: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return pdfDoc.embedPng(buffer);
  }
  // JPEG 头: FF D8
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    return pdfDoc.embedJpg(buffer);
  }
  // 其他格式（WebP/GIF/BMP）pdf-lib 不直接支持。
  // 这里尝试当作 JPG 嵌入会失败，返回 null。
  return null;
}

/**
 * 分批下载，控制并发。失败的位置返回 null。
 */
async function downloadInBatches(fileIDs, batchSize) {
  const out = new Array(fileIDs.length).fill(null);
  for (let i = 0; i < fileIDs.length; i += batchSize) {
    const slice = fileIDs.slice(i, i + batchSize);
    const results = await Promise.all(slice.map(async (id, idx) => {
      try {
        const r = await cloud.downloadFile({ fileID: id });
        return r.fileContent;
      } catch (e) {
        console.error('[imgToPdf] 下载失败', id, e.message);
        return null;
      }
    }));
    results.forEach((buf, j) => { out[i + j] = buf; });
  }
  return out;
}

function sanitize(name) {
  return String(name || '').replace(/[^\w\u4e00-\u9fa5\-]/g, '_').slice(0, 40);
}
