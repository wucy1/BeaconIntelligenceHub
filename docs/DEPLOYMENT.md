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
| `CORS_ORIGINS` | Pages URL(s), e.g. `https://bih.pages.dev` |
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

## Cloudflare Pages

### GitHub → Cloudflare Pages（建議 A 階段上線方式）

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
| Node version | `20`（Pages 環境變數 `NODE_VERSION=20`，或 repo 根／`frontend` 的 `.nvmrc`） |

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
