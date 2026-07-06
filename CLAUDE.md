# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**图个简单 (PictureToolbox / image-toolbox-miniprogram)** is a WeChat Mini Program image toolbox — ~25 tools across three homepage groups: **AI 智能**, **基础处理**, **创意玩法**. The app is live and actively iterated (see `LAUNCH_DATES` in `pages/index/index.js` for the feature timeline).

> The earlier identity "NoWatermarkCowHorse / 去水印吧牛马" and "Project initialization phase" framing in older docs are **stale** — this is a multi-feature shipped app, not a single watermark-removal MVP. `部署和上线指南.md` is also stale (describes a 3-feature MVP and claims "纯本地处理/0成本/不需要AI") — do not treat it as authoritative.

## Tech Stack

- **Frontend**: Native WeChat Mini Program (WXML/WXSS/JS). **No UI library** — Vant Weapp is *not* used despite old specs mentioning it (verified: zero `@vant` references). Pure native components.
- **Backend**: WeChat Cloud Development (云开发) — Cloud Functions + Cloud Storage + Cloud Database. Cloud env: `cloud1-1gk79pjqd5e1ed35` (in `app.js`). AppID: `wx8ed5d72746a75703`.
- **AI**: Tencent Hunyuan VLM (`hunyuan-vision`) via `tencentcloud-sdk-nodejs`, called from cloud functions only.
- **On-device imaging**: Canvas 2D API + hand-written JS encoders (custom GIF encoder, LSB steganography, perceptual hash, EXIF via `piexifjs`).

## Development Workflow

There is **no CLI build/test/lint** — `package.json` has only a dummy `test` script. Everything runs through **WeChat Developer Tools (微信开发者工具)**:

1. Open the project root directly (flat layout — there is no `miniprogram/` subfolder).
2. After any npm dependency change: **工具 → 构建 npm**.
3. Deploy a cloud function: right-click its folder under `cloudfunctions/` → **上传并部署：云端安装依赖** (cloud installs `node_modules`).
4. Cloud Database collections (e.g. `rate_limit`) must be **created manually** in 云开发控制台 → 数据库 — cloud functions can `add` docs but cannot auto-create collections.
5. Preview/真机: **预览** → scan QR. Debug via Console + 云开发控制台 logs.

Root npm dep is just `piexifjs` (EXIF). Each cloud function has its own `package.json` (`wx-server-sdk` + `tencentcloud-sdk-nodejs`).

## Architecture: Two Execution Tiers

The single most important architectural fact: **features split between on-device and cloud**, and which tier a feature uses determines its privacy, cost, and failure characteristics.

**On-device (client-side, no cloud function)** — `utils/` holds the engines:
- `image-process.js` — compression (binary-search quality), `chooseImage`, `makeCheckThumb` (content-check thumbnails), `getFileSize`. Central hub, required by many pages.
- `gif-encoder.js` + `color-quantize.js` — multi-image → animated GIF, fully offline.
- `hidden-watermark.js` — blue-channel LSB steganography (embed/extract with keyed PRNG). *Caveat: dies under JPEG 4:2:0 chroma subsampling — see memory.*
- `image-hash.js` — perceptual hash for `similarity` (找重复图).
- `piexif.js` / `exif-tags.js` — EXIF read/strip.
- `format-recommend.js`, `id-photo-geometry.js`, `compare-helper.js`, `upscale-local.js`, `saliency-detect.js`, `colorize-detect.js`.
- Pages: compress, crop, convert, watermark, filter, splice, makeGif, colorAnalysis, similarity, hiddenWatermark, formatRecommend, exif, idPhoto.

**Cloud (cloud function + Hunyuan VLM)** — AI features that cannot run on-device:
- `aiCaption`, `aiImageChat` (multi-turn, image only first turn), `aiImageDescribe`, `aiMatting`, `aiStyleTransfer`, `aiUpscale`, `aiColorize`, `aiEraser`, `aiOCR`.
- Infrastructure functions: `secretCheck` (cred probe), `checkImage` (content security `imgSecCheck`/`msgSecCheck`), `analyzeImage`, `detectFace`, `imgToPdf`, `makeGif` (cloud variant).

## Cloud Function Anatomy

Each cloud function is an **isolated deployment unit** — it cannot `require` across directories, so shared helpers are **copied into every function's folder**. Standard layout (`cloudfunctions/<name>/`):

- `index.js` — main logic.
- `cloud-secret.js` — credential reader (identical copy per function).
- `content-check.js` — server-side `imgSecCheck` (identical copy per function).
- `package.json` — `wx-server-sdk` + `tencentcloud-sdk-nodejs`.
- `config.json` — **gitignored**; local placeholder file. Real secrets are env vars (see below).

**Canonical source for the two shared helpers is `cloudfunctionTemplate/`** (`cloud-secret.js`, `content-check.js`). When fixing a bug or changing behavior in either helper, update the canonical template **and** propagate the copy to every cloud function that carries it.

## Secret Management (critical)

- Tencent Cloud `SecretId`/`SecretKey` **never reach the frontend**. Verified: no `SECRET_ID`/`SECRET_KEY` strings anywhere under `pages/`.
- `cloud-secret.js` reads credentials in priority order: (1) cloud function env vars — `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` / `TENCENTCLOUD_REGION` (legacy fallbacks `SECRET_ID`/`SECRET_KEY`/`API_REGION`); (2) `local-config.json` in the function dir (gitignored, local debug only).
- **Placeholder detection**: values matching `your_*`, `你的`, `替换`, `xxxx`, `example`, `placeholder`, `_here`, or empty are treated as "not configured" — so a placeholder never gets sent to the signing path.
- Real secrets are set in **云开发控制台 → 云函数 → 环境变量**, not in any committed file.
- `app.js` calls `secretCheck` on launch → stores `globalData.secretConfigured` (`true`/`false`/`null`). The frontend holds only that boolean, never keys.

**Degradation honesty (convention, enforced across AI functions)**: when credentials are not configured → return explicitly-tagged demo/mock data (`demo:true` / `mock:true`) so the UI can label it "示例". When credentials *are* configured but the API call or parsing fails → return `success:false` with an error — **never silently substitute a mock for a real answer**. Do not fabricate model capabilities in copy; write "AI 配文（混元大模型）", not marketing claims.

## Content Security (critical)

Two layers, both using standardized prompts that **never expose the label or specific reason** for a rejection:

- **Frontend guard**: `utils/content-check.js` → `guardImage(filePath)` / `guardText(text)` → calls `checkImage` cloud function (`imgSecCheck`/`msgSecCheck`, synchronous). Violation → toast "图片可能包含违规内容，请更换后重试" / "文字内容可能违规，请修改后重试" and return `false`.
- **Server-side guard**: each cloud function's `content-check.js` → `assertImageSafe(buffer, cloud)` → `cloud.openapi.security.imgSecCheck`. Violation → throws "图片包含违规内容，请更换后重试" (caught by the function's own try/catch, returned as `success:false`).

**FAIL_OPEN**: a *service anomaly* (permissions, rate limit, timeout) degrades to **allow** — transient faults must not block legitimate users. Only a confirmed *violation* blocks. Images >1MB skip server-side check (frontend thumbnail check is primary). Note the lazy `require('./image-process')` inside `content-check.js` — it breaks a circular-dependency deadlock with `image-process.chooseImage`; do not hoist it to module top.

## Hunyuan VLM Integration

- Client: `tencentcloud.hunyuan.v20230901.Client`, method `ChatCompletions`, `Model: 'hunyuan-vision'`, `Stream: false`, `signMethod: 'TC3-HMAC-SHA256'`.
- **Message format gotcha**: multimodal (image-bearing) messages use the **`Contents` array** (`[{Type:'image_url', ImageUrl:{Url}}, {Type:'text', Text}]`); pure-text messages use the **`Content` string** field. Mixing the two across multi-turn history breaks the call — see `cloudfunctions/aiImageChat/index.js` for the canonical pattern (first turn carries the image via `Contents`; follow-up turns are plain `Content` strings, image is not re-uploaded to save tokens).
- AI functions that return structured output (e.g. `aiCaption`'s 3 candidate captions) use a **3-tier JSON parse**: direct `JSON.parse` → strip ```` ```json ```` fence → regex-extract `[...]`. Strengthen prompts with hard constraints (字数/话题数) and end with "只返回纯 JSON 字符串数组，不要 markdown 代码块".

## Design System (app.wxss)

Cyberpunk "IMAGE LAB" theme. **Always use the design tokens** declared on `page` — do not introduce ad-hoc hex colors:

- Colors: `--color-deep-space` (#0A0E27 bg), `--color-neon-cyan` (#00F0FF), `--color-hot-magenta` (#FF0080), `--color-electric-purple`, `--color-solar-flare`.
- Gradients: `--gradient-neon` (cyan→magenta, primary CTA), `--gradient-heat`.
- Spacing `--space-xs/sm/md/lg/xl`, radii `--radius-sm/md/lg/xl`, shadows `--shadow-neon`/`--shadow-magenta`/`--shadow-card`.
- Utility classes: `.container`, `.card` (glassmorphism), `.btn` + `.btn-primary` (gradient + sweep) + `.btn-secondary` (outline), `.text-primary`, `.flex-center`/`.flex-between`.

**Global button rule** (app.wxss): every native `<button>` is forced to `display:flex; align-items:center; justify-content:center; padding:0; box-sizing:border-box; white-space:nowrap`. Consequence: **button text must stay on one line** — keep labels short, and when a page styles its own `.btn-*` it should not fight `display`/`padding`. The dark grid background is painted on `page::before` (z-index:0); page content sits at z-index:1.

## Adding a Feature

The homepage `pages/index/index.js` is the **single registry**. To ship a new tool:

1. Create `pages/<name>/` with `.js/.json/.wxml/.wxss` (native, no `usingComponents` unless a page genuinely needs a component).
2. Register the path in `app.json` `pages[]`.
3. Add a tool entry to the appropriate group in `index.js` `data.groups` (`ai` / `basic` / `creative`): `{id, name, desc, url, available:true, isNew}`.
4. For the NEW badge: add `'<id>': 'YYYY-MM-DD'` to `LAUNCH_DATES`. The badge is **auto-managed** — shown while `today - launchDate < NEW_WINDOW_DAYS (14)`, then auto-removed. Never manually toggle `isNew`; `onLoad` recomputes it from `LAUNCH_DATES`.
5. Add an `.icon-<id>` rule in `pages/index/index.wxss` (existing icons use an image frame `::before` + a small animation `::after`).
6. Use the design tokens; do not fork the theme.

## Conventions & Gotchas

- **Cloud functions run UTC.** Anything date-keyed by Beijing day (e.g. `aiCaption`'s daily `rate_limit` counter) must compute the Beijing date manually: `new Date(Date.now() + 8*3600*1000).toISOString().slice(0,10)`.
- **Rate limiting** (`aiCaption`): `rate_limit` Cloud DB collection, doc `_id = ${openid}_${YYYY-MM-DD}`, atomic `inc(1)`. If the collection is missing, `catch` degrades to **pass** with a `console.error` prompting manual creation — do not let rate-limit failure block the request.
- **`wx.compressImage` forces JPG output** and drops alpha — for any downsampling that must preserve transparency, draw the original directly onto a smaller canvas instead. (See memory: `wx-compressimage-lossy-jpg-no-alpha`.)
- **Blue-channel LSB steganography is destroyed by JPEG 4:2:0** chroma subsampling. JPEG-resistant steganography must live in luma or the DCT domain. (See memory: `stego-blue-lsb-dies-under-jpeg-420`.)
- **Hand-written binary formats (GIF LZW, etc.)** must be cross-validated against a reputable library before trusting output — the LZW code-width increment rule and NETSCAPE2.0 magic size are easy to get wrong. (See memory: `gif-lzw-width-rule-gotcha`.)
- **`rebase` can silently drop large block swaps** — exit 0 does not mean structural changes landed. After any rebase, `grep`-verify that moved/renamed blocks actually exist where expected. (See memory: `rebase-silent-block-swap-loss`.)
- **Replicate** (if used for any model): old models 404 on `/models/{owner}/{name}/predictions` — use `/v1/predictions` + pinned `version`. A deployed model version is a code snapshot; trust the actual prediction output over `predict.py`. (See memory.)

## Gitignore notes

`cloudfunctions/*/config.json`, `cloudfunctions/**/local-config.json`, `node_modules/`, `miniprogram_npm/`, `package-lock.json`, `.claude/`, and `project.private.config.json` are gitignored. The `config.json` files exist locally with placeholders only — they are not the source of truth for secrets (env vars are).
