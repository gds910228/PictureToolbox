// cloudfunctions/detectFace/index.js
// 腾讯云 IAI DetectFace：静态图人脸检测，返回人脸框 + 姿态角(roll/pitch/yaw)。
// 供「证件照制作」做 roll 校正 + 居中定位。复用 aiMatting 的 cloud-secret + content-check 模式。
//
// 入参：{ fileID }  或  { url }（探针用公网图）
// 返回：
//   成功且检出人脸 → { success, face:{x,y,width,height}, roll, pitch, yaw, imageWidth, imageHeight }
//   未检出人脸     → { success:true, noFace:true }
//   失败           → { success:false, error, code? }

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { fileID, url } = event || {};
  try {
    const cred = secret.assertCredentials();

    let imageBase64 = null;
    if (fileID) {
      const dl = await cloud.downloadFile({ fileID });
      const buf = dl.fileContent;
      await contentCheck.assertImageSafe(buf, cloud);   // 服务端内容安全兜底
      imageBase64 = buf.toString('base64');
    } else if (!url) {
      return { success: false, error: '缺少 fileID 或 url' };
    }

    const IaiClient = tencentcloud.iai.v20180301.Client;
    const client = new IaiClient({
      credential: { secretId: cred.secretId, secretKey: cred.secretKey },
      region: cred.region || 'ap-guangzhou',
      profile: { signMethod: 'TC3-HMAC-SHA256' }
    });

    const params = {
      MaxFaceNum: 1,
      MinFaceSize: 34,
      NeedFaceAttributes: 1,     // 返回姿态角 roll/pitch/yaw
      NeedRotateDetection: 1,   // 旋转图也能检出
      FaceModelVersion: '3.0'
    };
    if (imageBase64) params.Image = imageBase64;
    else params.Url = url;

    const resp = await client.DetectFace(params);
    // SDK 可能返回 { Response: {...} } 或已展开，两种都兼容
    const r = (resp && resp.Response) ? resp.Response : (resp || {});

    if (code_isNoFace(resp, r)) {
      return { success: true, noFace: true, imageWidth: r.ImageWidth, imageHeight: r.ImageHeight };
    }

    const faceInfos = r.FaceInfos || [];
    if (!faceInfos.length) {
      return { success: true, noFace: true, imageWidth: r.ImageWidth, imageHeight: r.ImageHeight };
    }
    const f = faceInfos[0];
    const attr = f.FaceAttributesInfo || {};
    return {
      success: true,
      face: { x: f.X, y: f.Y, width: f.Width, height: f.Height },
      roll: attr.Roll,
      pitch: attr.Pitch,
      yaw: attr.Yaw,
      eyeOpen: attr.EyeOpen,
      imageWidth: r.ImageWidth,
      imageHeight: r.ImageHeight
    };
  } catch (err) {
    console.error('[detectFace] 失败', err && (err.stack || err.message || err));
    const code = err && (err.code || err.errCode);
    if (code === 'InvalidParameterValue.NoFaceInPhoto') {
      return { success: true, noFace: true };
    }
    return { success: false, error: err && (err.message || String(err)), code };
  }
};

// 兼容：腾讯云 SDK 抛错时把错误码塞在 response.Error.Code
function code_isNoFace(resp, r) {
  const c = (r && r.Error && r.Error.Code) || (resp && resp.code) || (resp && resp.errCode);
  return c === 'InvalidParameterValue.NoFaceInPhoto';
}
