# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**NoWatermarkCowHorse (去水印吧牛马)** is a WeChat Mini Program that provides one-click image watermark removal functionality using cloud-based AI/ML services.

**Current Status**: Project initialization phase. Configuration files are complete, and a detailed development specification exists (in Chinese), but implementation has not yet begun.

## Technology Stack

- **Frontend**: Native WeChat Mini Program Framework (WXML, WXSS, JavaScript)
- **UI Library**: Vant Weapp - Mobile UI components for WeChat mini programs
- **Backend**: WeChat Cloud Development (微信小程序·云开发)
  - Cloud Functions (serverless functions)
  - Cloud Storage (object storage)
- **Third-party API**: Tencent Cloud Image Content Security (IMS) or similar for image processing
- **Development Tool**: WeChat Developer Tools (微信开发者工具)

## Development Environment Setup

### Prerequisites
1. WeChat Developer Tools (微信开发者工具)
2. WeChat Mini Program account with AppID
3. WeChat Cloud Development environment
4. Tencent Cloud account with API credentials (SecretId/SecretKey)

### Initial Setup Commands

```bash
# Navigate to frontend directory (NOT YET CREATED)
cd miniprogram

# Install Vant Weapp UI library
npm i @vant/weapp -S --production

# In WeChat Developer Tools: Tools → Build npm (工具 → 构建 npm)
```

```bash
# Navigate to cloud function directory (NOT YET CREATED)
cd cloudfunctions/removeWatermark

# Install Tencent Cloud SDK for backend
npm install tencentcloud-sdk-nodejs --save
```

After installing dependencies:
1. Open project in WeChat Developer Tools
2. Enable Cloud Development (云开发) in the IDE
3. Create cloud development environment
4. Build npm packages: **Tools → Build npm (工具 → 构建 npm)**
5. Deploy cloud functions: Right-click cloud function folder → **Upload and Deploy (上传并部署)**

## Project Structure

```
NoWatermarkCowHorse/
├── miniprogram/              # Frontend code (NOT YET CREATED)
│   ├── pages/
│   │   ├── index/           # Home page (upload interface)
│   │   └── result/          # Result page (display processed image)
│   ├── miniprogram_npm/     # Built npm packages (auto-generated)
│   ├── package.json         # Frontend dependencies
│   ├── app.js               # Application entry
│   ├── app.json             # Global configuration (register Vant components here)
│   └── app.wxss             # Global styles
│
├── cloudfunctions/          # Backend cloud functions (NOT YET CREATED)
│   └── removeWatermark/     # Watermark removal function
│       ├── index.js         # Main function logic
│       ├── package.json     # Function dependencies
│       └── config.json      # Environment variables (store API keys here!)
│
├── project.config.json      # WeChat project configuration
├── project.private.config.json  # Private project settings
└── 去图片水印微信小程序开发分析.md  # Complete development spec (Chinese)
```

## Architecture

**Pattern**: Client-Serverless Architecture

**Flow**:
1. User uploads image via `pages/index/index`
2. Image uploaded to Cloud Storage via `wx.cloud.uploadFile()`
3. Cloud Function `removeWatermark` processes image using third-party API
4. Processed image saved to Cloud Storage
5. Result displayed in `pages/result/result`

**Security Model**:
- API keys (Tencent Cloud SecretId/SecretKey) MUST be stored in cloud function environment variables (`config.json`)
- NEVER expose API keys in frontend code
- Cloud Functions run server-side with full access to APIs

## Key Configuration Files

### `project.config.json`
- `appid`: WeChat Mini Program AppID (wx8ed5d72746a75703)
- `libVersion`: WeChat base library version (3.14.0)
- `setting.es6`: ES6 transpilation enabled
- `setting.minified`: Code minification enabled

### Cloud Function `config.json` (NOT YET CREATED)
Store Tencent Cloud API credentials as environment variables:
```json
{
  "permissions": {
    "openapi": []
  },
  "env": {
    "TENCENTCLOUD_SECRET_ID": "your_secret_id_here",
    "TENCENTCLOUD_SECRET_KEY": "your_secret_key_here"
  }
}
```

### `miniprogram/app.json` (NOT YET CREATED)
Register Vant Weapp components globally:
```json
{
  "usingComponents": {
    "van-button": "@vant/weapp/button/index",
    "van-uploader": "@vant/weapp/uploader/index",
    "van-image": "@vant/weapp/image/index",
    "van-toast": "@vant/weapp/toast/index",
    "van-loading": "@vant/weapp/loading/index"
  },
  "pages": [
    "pages/index/index",
    "pages/result/result"
  ]
}
```

## Development Workflow

1. **Code**: Write frontend code in `miniprogram/` and cloud functions in `cloudfunctions/`
2. **Build**: Run **Tools → Build npm** in WeChat Developer Tools after installing packages
3. **Deploy Cloud Functions**: Right-click cloud function → **Upload and Deploy: Cloud Install Dependencies (上传并部署：云端安装依赖)**
4. **Test**: Click **Preview (预览)** button, scan QR code with WeChat
5. **Debug**: Use Console and Debugger in WeChat Developer Tools
6. **Upload**: Click **Upload (上传)** button to submit for review

## Important Implementation Notes

### Cloud Function Processing
The cloud function `removeWatermark/index.js` needs to:
1. Receive `fileID` from frontend
2. Convert `fileID` to temporary URL using `cloud.getTempFileURL()`
3. Call third-party API (Tencent Cloud IMS or similar)
4. Download processed result
5. Upload processed image to Cloud Storage
6. Return new `fileID` to frontend

**Current State**: The specification includes a **simulated** API call that returns the original image. This MUST be replaced with actual API integration.

### Frontend Pages
- **index**: Upload interface with Vant Uploader component
- **result**: Display processed image with save-to-album functionality

### Language & Context
- Primary documentation is in **Chinese**
- Target audience is Chinese users
- UI text should be in Chinese

## Common Tasks

### Adding a New Page
1. Create directory in `miniprogram/pages/`
2. Create four files: `.js`, `.json`, `.wxml`, `.wxss`
3. Register page in `miniprogram/app.json` `pages` array

### Creating a Cloud Function
1. Right-click `cloudfunctions/` directory → **New Node.js Cloud Function (新建Node.js云函数)**
2. Add function name
3. Install dependencies in function directory
4. Configure `config.json` for environment variables
5. Right-click function folder → **Upload and Deploy (上传并部署)**

### Testing
- Use WeChat Developer Tools **Preview** for real device testing
- Use Simulator for basic UI testing
- Check Cloud Function logs in **Cloud Development Console (云开发控制台)**

## References

- **Complete Development Specification**: `去图片水印微信小程序开发分析.md` (Chinese language, 7 sections)
- **WeChat Mini Program Docs**: https://developers.weixin.qq.com/miniprogram/dev/framework/
- **Vant Weapp Docs**: https://vant-contrib.gitee.io/vant-weapp/#/home
- **WeChat Cloud Development**: https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html
