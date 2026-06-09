# BIH deployment — Cloudflare Pages + R2 + Neon

## Stack

| Component | Service |
|-----------|---------|
| Web UI | Cloudflare Pages (`frontend/dist`) |
| API | FastAPI on Fly.io / Railway / Render (long-running) |
| Database | Neon Postgres + PostGIS |
| Images | Cloudflare R2 (S3-compatible presigned PUT/GET) |
| Mobile | Capacitor (`webDir: frontend/dist`) |

## Environment variables (API)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon connection string (`postgresql+psycopg2://...?sslmode=require`) |
| `PUBLIC_BASE_URL` | Public API URL (no trailing slash) |
| `CORS_ORIGINS` | 前端網址（逗號分隔），例如 `https://beacon.cila.workers.dev` |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret |
| `R2_BUCKET` | Bucket name (e.g. `bih`) |
| `UPLOAD_VIA_API` | Optional. `true` = browser PUTs to API, server writes R2. Unset + `PUBLIC_BASE_URL` on localhost = auto proxy (local dev). `false` = browser presigned PUT to R2 (needs CORS below). |
| `ADMIN_TOKEN` | Secret for `/v1/admin/*` (header `X-Admin-Token`) |

## Local dev with R2 credentials

If all four `R2_*` vars are set but `PUBLIC_BASE_URL` is `http://127.0.0.1:8000`, presign returns `/v1/uploads/receive/{token}` and the API uploads to R2 — **no R2 bucket CORS required**. Restart uvicorn after changing `.env`.

## R2 CORS (browser direct upload)

In R2 bucket **Settings → CORS**, allow your Pages origin:

```json
[
  {
    "AllowedOrigins": ["https://YOUR_PROJECT.pages.dev", "http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Cloudflare（前端）

### Workers 與 Pages 怎麼分？（介面容易混）

Cloudflare 現在把兩者都放在 **Workers & Pages** 底下，但流程不同：

| | **Workers Builds**（你目前在用的） | **Pages（傳統靜態站）** |
|---|-----------------------------------|-------------------------|
| 怎麼建立 | Worker → **Builds** → Connect Git；或 Connect 時出現 **Deploy command（必填）** | **Create application → Pages** → Connect to Git |
| 建置後 | `npx wrangler deploy` 依 `wrangler.toml` 上傳 `dist` | 自動發佈 **Build output directory**（`dist`），**沒有** Deploy command |
| 設定檔 | `frontend/wrangler.toml`（`name = "beacon"`） | 通常不需 wrangler |
| 網址樣式 | `beacon.<帳號>.workers.dev` 或自訂網域 | `*.pages.dev` |
| BIH 建議 | **已採用**（repo 已含 wrangler） | 亦可，但不必兩套同時建 |

### PWA / Service Worker（離線可開首頁）

前端已啟用 `vite-plugin-pwa` 產生 `sw.js`。第一次線上開啟後會預快取首頁殼與資產，使離線時仍可進入首頁並使用離線回報/離線瓦片。

- 若遇到桌機仍在舊版：請清除本站資料（Cache/Storage/Service Worker）後再試。

路徑記法：**同一個 repo、Root = `frontend/`**；差別只在 Cloudflare 用 Worker 還是 Pages 專案去接 Git。

### 方式 A：Workers Builds（你目前畫面：必填 Deploy command）

Cloudflare「Connect to a repository」若出現 **Deploy command（Required）**，代表走的是 **Workers Builds**，不是傳統 Pages。本 repo 已在 `frontend/wrangler.toml` 設定靜態資產目錄為 `dist`（含 SPA 路由）。

| 欄位 | 值 |
|------|-----|
| Path / Root | `frontend` |
| Build command | `npm ci && npm run build` |
| **Deploy command** | `npx wrangler deploy` |
| Non-production deploy（可選） | `npx wrangler versions upload` |

**Build variables（可選）：**

| 變數 | 說明 |
|------|------|
| `NODE_VERSION` | **`22`**（Wrangler 4 需 Node ≥22；見 `frontend/.nvmrc`） |
| `VITE_API_BASE` | API 上線後再填；未部署前可留空 |

首次 Connect 前請確認 GitHub `main` 已包含 `frontend/wrangler.toml`（否則 deploy 找不到設定）。

### 方式 B：Cloudflare Pages（無 Deploy command 欄位時）

### GitHub → Cloudflare Pages

1. **GitHub 儲存庫**
   - 建立 repo（例如 `crointel/BeaconIntelligenceHub`）。
   - 專案署名：**BIH Team** · **info@crointel.com**（見根目錄 `AUTHORS.md`）。
   - 本機僅在此 repo 設定 commit 作者（勿改全域 git config）：
     ```powershell
     git init
     git config user.name "BIH Team"
     git config user.email "bih-team@users.noreply.github.com"
     ```
   - 推送前確認：`git log -1 --format="%an <%ae>"` 應為 `BIH Team <bih-team@users.noreply.github.com>`。
   - GitHub **Settings → General → Social preview / Description** 可填維護者與聯絡 email。

2. **Cloudflare Dashboard**
   - **Workers & Pages → Create → Pages → Connect to Git** → 選 GitHub repo。
   - **Production branch：** `main`（或你的預設分支）。
   - **Framework preset：** None 或 Vite（若選 Vite 仍請確認下列路徑）。

3. **Build 設定**

| 欄位 | 值 |
|------|-----|
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Node version | **`22`**（Build variable `NODE_VERSION=22`，或 `frontend/.nvmrc`） |

4. **Pages 環境變數（Production）**

| 變數 | 值 |
|------|-----|
| `VITE_API_BASE` | 後端公開 URL（**無**尾隨 `/`），例如 `https://api.example.com` |

5. **首次部署後**
   - 記下 Pages URL（例如 `https://bih.pages.dev`）。
   - 後端 `CORS_ORIGINS` 加入該 URL；R2 CORS 同上（若瀏覽器直傳 R2）。
   - 冒煙：`/v1/public/active-window`、地圖 markers、提交含圖。

6. **自訂網域（可選）**  
   Pages → **Custom domains** → 依 Cloudflare DNS 指示綁定。

> API（FastAPI）**不**部署在 Pages；需另部署至 Fly / Railway / Render 等，並在 Pages 只設定 `VITE_API_BASE` 指向該 API。

### Build 設定摘要

- **Root directory:** `frontend`
- **Build command:** `npm ci && npm run build`
- **Output directory:** `dist`
- **Environment variable:** `VITE_API_BASE=https://your-api.example.com`

## 後端 API

前端已上線（例如 `https://beacon.cila.workers.dev`）時，畫面報 `Unexpected token '<'` 代表瀏覽器打到 **Worker 的 HTML**，不是 JSON API——需部署 FastAPI 並設定 `VITE_API_BASE`。

### 平台怎麼選？

| 平台 | 信用卡 | 說明 |
|------|--------|------|
| **Fly.io** | **通常必填**（驗證用，免費額度內多數不扣款） | 有 `fly.toml`；無法完成驗證就改 Render |
| **Render** | 註冊有時較寬鬆；Free 方案可能仍會要求驗證 | **無 Fly 時建議用這個**；`backend/render.yaml` |
| **Railway** | 多數需綁卡後才有額度 | GitHub 一鍵部署，Root=`backend` |
| **自有 VPS** | 無 | Docker 跑 `backend/Dockerfile` |

> 多數 PaaS 會要求付款方式以防濫用；若完全不想綁卡，只能自建主機或請已開通帳號的團隊代部署。

### 步驟 1：Neon 資料庫（若尚未建立）

1. [Neon](https://neon.tech) 建立專案。
2. SQL Editor 執行：`CREATE EXTENSION IF NOT EXISTS postgis;`
3. 新庫執行完整 `backend/db/init.sql`（示範危機 + 建物）。
4. 複製 **Pooled** 連線字串，前綴改為 `postgresql+psycopg2://...?sslmode=require`。

詳見 `docs/NEON_CONNECTIVITY.md`。

### 步驟 2A：部署到 Render（無 Fly / 不想先綁 Fly 卡時）

1. [render.com](https://render.com) 註冊並連 GitHub `wucy1/BeaconIntelligenceHub`。
2. **New → Web Service** → 選該 repo。
3. 設定：

| 欄位 | 值 |
|------|-----|
| Root Directory | `backend` |
| Runtime | **Docker** |
| Dockerfile Path | `./Dockerfile` |
| Plan | Free（冷啟動較慢，可接受） |
| Health Check Path | `/health`（輕量、不連 DB；深度檢查用 `/health/ready`） |

4. **Environment**（至少）：

| Key | Value |
|-----|--------|
| `DATABASE_URL` | Neon pooled 連線字串（`postgresql+psycopg2://...`） |
| `PUBLIC_BASE_URL` | 部署完成後 Render 給的 URL，如 `https://bih-api.onrender.com` |
| `CORS_ORIGINS` | `https://beacon.cila.workers.dev` |
| `REPORTER_SALT` | 隨機長字串 |
| `ADMIN_TOKEN` | 管理密鑰 |
| `PORT` | `8080`（Dockerfile 預設） |

5. **Create Web Service**，等第一次 deploy 成功。
6. 瀏覽器測：`https://你的服務.onrender.com/v1/public/active-window` → 應為 JSON。

也可用 **Blueprint**：`backend/render.yaml`（於 Render 選 Blueprint 並指向該檔）。

### 步驟 2B：部署到 Fly.io（需完成信用卡驗證）

本 repo 已含 `backend/Dockerfile`、`backend/fly.toml`。Windows 指令為 **`flyctl`**（安裝：`iwr https://fly.io/install.ps1 -useb | iex`）。

```powershell
cd d:\Cursor-Projects\BeaconIntelligenceHub\backend
flyctl auth login
flyctl apps create bih-api
flyctl deploy
```

### 步驟 3：設定 API 環境變數（Fly 用 secrets）

將下列值換成你的實際內容（**不要**提交到 Git）：

Render：在 Dashboard → **Environment** 填寫下列變數。Fly：

```powershell
flyctl secrets set `
  DATABASE_URL="postgresql+psycopg2://USER:PASS@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require" `
  PUBLIC_BASE_URL="https://bih-api.fly.dev" `
  CORS_ORIGINS="https://beacon.cila.workers.dev" `
  REPORTER_SALT="隨機長字串" `
  ADMIN_TOKEN="管理用密鑰"
```

- `PUBLIC_BASE_URL` = Fly 部署後的 HTTPS 網址（`fly deploy` 結尾會顯示，或 `fly apps open`）。
- 若暫無 R2，可先不設 `R2_*`（上傳會走 API 本機 storage 路徑，生產建議盡快接 R2）。

**有 R2 時再加：**

```powershell
flyctl secrets set `
  R2_ACCOUNT_ID="..." `
  R2_ACCESS_KEY_ID="..." `
  R2_SECRET_ACCESS_KEY="..." `
  R2_BUCKET="bih" `
  UPLOAD_VIA_API="true"
```

R2 bucket CORS 需允許 `https://beacon.cila.workers.dev`（PUT/GET）。

### 步驟 4：驗證 API

```text
https://你的-api網址/health
https://你的-api網址/health/ready
https://你的-api網址/v1/public/active-window
```

**Render 反覆「health check timed out after 5 seconds」：** 多半是 `/health` 在冷啟動時連 Neon 逾時。本專案 `/health` 已改為立即回 200；請確認 Dashboard 的 Health Check Path 為 `/health`（不是 `/health/ready`），並 Redeploy。

應回 JSON，不是 HTML。

### 步驟 5：接回 Cloudflare 前端

1. Worker **Build variables**（Production）：`VITE_API_BASE` = `https://beaconintelligencehub.onrender.com`（無尾 `/`）。
2. **Retry deployment**（必須重新 `npm run build`，才會寫進 JS）。
3. Render **Environment**：`CORS_ORIGINS` = `https://beacon.cila.workers.dev`（無尾 `/`），儲存後 Redeploy API。
4. 瀏覽器 **清除本站資料**（或 DevTools → Application → Clear site data），避免舊版 JS / Service Worker。
5. 重新開前端；DevTools → **Network** 應看到請求打到 `onrender.com/v1/...`，**不是** `beacon.cila.workers.dev/v1/...`。

**若錯誤含 `Unexpected token '<'` 或 HTML 而非 JSON：**  
代表請求仍打到 Worker 的 SPA（`/v1` 會回 `index.html`），通常是 **快取舊 bundle** 或 **VITE_API_BASE 未進入該次 build**。

### Railway（備選）

New Project → GitHub repo → Root `backend` → Start command：

`uvicorn app.main:app --host 0.0.0.0 --port $PORT`

環境變數同 Render 表格。

---

## Neon migrations

1. In Neon Console → **SQL Editor**, run: `CREATE EXTENSION IF NOT EXISTS postgis;`
2. Run full `backend/db/init.sql` on an **empty** database (creates demo crisis + buildings).
3. If the DB already has tables, run migrations `002`–`005` as needed (`005` renames `demo-taipei` → `unspecified`).

## Contributor reporting (no pre-drawn boundary)

Disasters may start **before** admins can define an impact polygon. Contributor reports are **not** gated on `crises.bounds` (nullable, reference-only for admin). Location = `building_id` and/or GeoJSON `Point` and/or `textual_location`. Admin assignment to programs/AOIs is a later phase (spatio-temporal join).

## Local dev — pick ONE database

**Option A — Docker (recommended if no Neon yet)**

```bash
docker compose up -d
```

`backend/.env`:

```env
DATABASE_URL=postgresql+psycopg2://crisis:crisis@127.0.0.1:5432/crisis
```

**Option B — Neon**

1. Neon Console → copy **pooled** connection string.
2. Use **only one** `DATABASE_URL` line in `backend/.env` (do not duplicate).
3. Format example (replace with your values from Console):

```env
DATABASE_URL=postgresql+psycopg2://USER:PASSWORD@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
```

4. Do **not** add `channel_binding=require` (often breaks on Windows).
5. Verify:

```bash
cd backend
python scripts/check_db.py
python -m uvicorn app.main:app --reload --port 8000
```

Open `http://127.0.0.1:8000/v1/public/active-window` — should return JSON, not 500.

### Common errors

| Error | Cause | Fix |
|-------|--------|-----|
| `Connection refused` on `127.0.0.1:5432` | Local Postgres not running | `docker compose up -d` or switch `.env` to Neon |
| `server closed the connection unexpectedly` (Neon) | Wrong URL, DB asleep, or schema/PostGIS missing | Wake project in Neon; run `init.sql`; use pooled URL + `sslmode=require` |
| `No active reporting window` (503) | DB OK but empty `crises` | Run `init.sql` seed |

## Capacitor

```bash
cd frontend && npm run build
npx cap sync
npx cap open android   # or ios
```

Set `VITE_API_BASE` at build time to your production API.
