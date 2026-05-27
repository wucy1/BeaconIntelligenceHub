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

## 後端 API（Fly.io，建議下一步）

前端已上線（例如 `https://beacon.cila.workers.dev`）時，畫面報 `Unexpected token '<'` 代表瀏覽器打到 **Worker 的 HTML**，不是 JSON API——需部署 FastAPI 並設定 `VITE_API_BASE`。

### 步驟 1：Neon 資料庫（若尚未建立）

1. [Neon](https://neon.tech) 建立專案。
2. SQL Editor 執行：`CREATE EXTENSION IF NOT EXISTS postgis;`
3. 新庫執行完整 `backend/db/init.sql`（示範危機 + 建物）。
4. 複製 **Pooled** 連線字串，前綴改為 `postgresql+psycopg2://...?sslmode=require`。

詳見 `docs/NEON_CONNECTIVITY.md`。

### 步驟 2：部署 API 到 Fly.io

本 repo 已含 `backend/Dockerfile`、`backend/fly.toml`。

```powershell
# 安裝 Fly CLI：https://fly.io/docs/hands-on/install-flyctl/
cd d:\Cursor-Projects\BeaconIntelligenceHub\backend
fly auth login
fly apps create bih-api   # 名稱若被占用可改 fly.toml 的 app =
fly deploy
```

### 步驟 3：設定 Fly secrets（環境變數）

將下列值換成你的實際內容（**不要**提交到 Git）：

```powershell
fly secrets set `
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
fly secrets set `
  R2_ACCOUNT_ID="..." `
  R2_ACCESS_KEY_ID="..." `
  R2_SECRET_ACCESS_KEY="..." `
  R2_BUCKET="bih" `
  UPLOAD_VIA_API="true"
```

R2 bucket CORS 需允許 `https://beacon.cila.workers.dev`（PUT/GET）。

### 步驟 4：驗證 API

```text
https://bih-api.fly.dev/health
https://bih-api.fly.dev/v1/public/active-window
```

應回 JSON，不是 HTML。

### 步驟 5：接回 Cloudflare 前端

1. Worker **Build variables**：`VITE_API_BASE` = `https://bih-api.fly.dev`（你的 API URL，無尾 `/`）。
2. **Retry deployment**（Vite 會把 API 網址 bake 進 bundle）。
3. 重新開 `https://beacon.cila.workers.dev`，地圖應能載入 markers。

### 替代平台

| 平台 | 作法 |
|------|------|
| **Railway** | New Project → Deploy from GitHub → Root `backend` → Start：`uvicorn app.main:app --host 0.0.0.0 --port $PORT` → 同上 env |
| **Render** | Web Service + `backend/Dockerfile` 或 Python，設定相同 env |

---

## Neon migrations

1. In Neon Console → **SQL Editor**, run: `CREATE EXTENSION IF NOT EXISTS postgis;`
2. Run full `backend/db/init.sql` on an **empty** database (creates demo crisis + buildings).
3. If the DB already has tables, run only `backend/db/migrations/002_admin_and_latest.sql`.

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
