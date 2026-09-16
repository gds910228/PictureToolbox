// utils/exif-tags.js
// 常用 EXIF tag id 常量（数值取自 piexifjs / EXIF 2.3 规范）
// 这样页面端不必依赖 piexif 内部命名空间，配置/格式化逻辑更清晰。

module.exports = {
  // 主图像 IFD (0th)
  IMAGE: {
    Make: 271,                  // 设备厂商
    Model: 272,                 // 设备型号
    Software: 305,              // 软件
    DateTime: 306,              // 修改时间
    Artist: 315,                // 作者
    Copyright: 33432,           // 版权
    ImageDescription: 270,      // 描述
    Orientation: 274,           // 方向
    XResolution: 282,
    YResolution: 283,
    ResolutionUnit: 296
  },

  // EXIF SubIFD
  EXIF: {
    DateTimeOriginal: 36867,    // 拍摄时间（最敏感）
    DateTimeDigitized: 36868,   // 数字化时间
    OffsetTime: 36880,          // 时区
    LensModel: 42036,           // 镜头型号
    LensMake: 42035,            // 镜头厂商
    FNumber: 33437,             // 光圈
    ExposureTime: 33434,        // 曝光时间
    ISOSpeedRatings: 34855,     // ISO
    FocalLength: 37386,         // 焦距
    FocalLengthIn35mmFilm: 41989,
    Flash: 37385,               // 闪光灯
    WhiteBalance: 41987,        // 白平衡
    PixelXDimension: 40962,     // 像素宽
    PixelYDimension: 40963,     // 像素高
    ExposureBiasValue: 37380,
    MeteringMode: 37383,
    SceneCaptureType: 41990,
    SubjectDistance: 37382,
    BodySerialNumber: 42033     // 机身序列号（敏感）
  },

  // GPS IFD
  GPS: {
    GPSVersionID: 0,
    GPSLatitudeRef: 1,          // N/S
    GPSLatitude: 2,             // 度分秒
    GPSLongitudeRef: 3,         // E/W
    GPSLongitude: 4,            // 度分秒
    GPSAltitudeRef: 5,
    GPSAltitude: 6,
    GPSTimeStamp: 7,
    GPSDateStamp: 29,
    GPSImgDirection: 17,
    GPSImgDirectionRef: 16,
    GPSSpeed: 13,
    GPSSpeedRef: 12
  }
};
