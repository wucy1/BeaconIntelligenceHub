# Beacon Intelligence Hub (BIH) — 第一階段 MVP

**維護者：** BIH Team · [info@crointel.com](mailto:info@crointel.com)

線上端到端流程：**填報（相片 → presign 上傳 → 建立報告）**、**PostGIS 儲存**、**儀表板列表**、**CSV / GeoJSON 匯出**。

## 先決條件

- Docker Desktop（PostGIS）
- Python 3.12+
- Node.js 20+

## 1. 啟動資料庫

```powershell
cd d:\Cursor-Projects\BeaconIntelligenceHub
docker compose up -d
```

首次啟動會執行 `backend/db/init.sql`（結構 + 預設 **`unspecified`** 開放回報事件 + 三個示範建物 footprint）。

## 2. 後端 API

```powershell
cd backend
python -m pip install -r requirements.txt
$env:DATABASE_URL = "postgresql+psycopg2://crisis:crisis@127.0.0.1:5432/crisis"
$env:PUBLIC_BASE_URL = "http://127.0.0.1:8000"
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- 健康檢查：<http://127.0.0.1:8000/health>
- OpenAPI：<http://127.0.0.1:8000/docs>
- 本機上傳檔案目錄：`backend/storage/`（由 presign → PUT 寫入）

## 3. 前端（Vite）

```powershell
cd frontend
npm install
npm run dev
```

開發時 Vite 會將 `/v1`、`/health` 代理到 `http://127.0.0.1:8000`。

瀏覽器開啟 <http://127.0.0.1:5173/>：

1. 首頁選「示範地震 — 台北示範區」→ 填寫表單並在地圖上點選建物 → 送出。
2. 開啟「儀表板」查看列表；可下載 CSV / GeoJSON。

## 示範資料 ID

- 危機：`a0000000-0000-0000-0000-000000000001`
- 建物：`b0000000-0000-0000-0000-000000000001` … `000003`

## 技術棧

- 前端：Vite + React + TypeScript + MapLibre GL
- 後端：FastAPI + SQLAlchemy + GeoAlchemy2 + PostGIS
- 物件儲存：本機目錄（開發）；若設定 `R2_*` 環境變數則改為 **Cloudflare R2**（S3 相容 presigned PUT/GET）

## 線上測試（Cloudflare Pages + R2 + Neon）

**分工**：靜態前端 → **Cloudflare Pages**；PostGIS → **Neon**；相片檔 → **R2**；**FastAPI** 需放在可常駐的服務（例如 Fly.io、Railway、Render），勿期望整支後端跑在 Pages Functions 內。

1. **Neon**：建立專案後在 SQL Editor 執行 `CREATE EXTENSION IF NOT EXISTS postgis;`，再執行或匯入 `backend/db/init.sql` 其餘內容。將連線字串設為 `DATABASE_URL`（建議帶 `sslmode=require`）。
2. **R2**：建立 bucket；建立 **API Token**（讀寫該 bucket）；在 bucket **CORS** 允許你的 Pages 網域對物件發起 **PUT**（`Content-Type`），以便瀏覽器直傳。將 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET` 寫入後端環境變數（見 `backend/.env.example`）。
3. **後端**：設定 `PUBLIC_BASE_URL` 為對外 API 根網址；`CORS_ORIGINS` 包含 `https://<專案>.pages.dev`（及自訂網域）。未設定四個 `R2_*` 時仍走本機 presign + `/v1/uploads/receive`。
4. **Cloudflare Pages**：Framework preset 選 Vite，或建置指令 `npm run build`、輸出目錄 `dist`。在 Pages **環境變數** 設定 `VITE_API_BASE`＝後端公開 URL（**勿**尾隨斜線），讓前端呼叫 API 與下載匯出連結正確。

**SPA 路由**：Pages 在專案根目錄**沒有** `404.html` 時，會依預設把子路徑交給單頁應用（適合 React Router）。若日後加入自訂 `404.html`，需另設 rewrite 規則。

## UNDP 功能（已實作）

- **i18n**：UI 預設英文，支援 EN / 繁中 / AR / FR / RU / ES（`frontend/src/i18n/`）
- **配置化問卷**：UNDP 核心題 + 模組化附錄（`frontend/src/config/questionnaire.ts`）
- **版本化損害**：`latest_report_per_building` view（complete > partial > minimal，再依時間）
- **離線佇列**：IndexedDB + PWA（`frontend/src/offline/queue.ts`）
- **管理端**：`/admin` + API `X-Admin-Token`（`ADMIN_TOKEN`）
- **分析**：`/v1/analytics/summary`
- **匯出**：`?latest=1` 匯出每棟最新狀態
- **教學腳本**：`docs/tutorial.md` · **部署**：`docs/DEPLOYMENT.md`

### Capacitor（輕量 App）

```powershell
npm install
npm run build:web
npm run cap:sync
```

## 開發進度（三階段）

| 階段 | 內容 | 狀態 |
|------|------|------|
| ① | Contributor 地圖回報（Leaflet、三模式、開放回報） | 進行中 |
| ② | 離線 PWA + 同步狀態機 | 未開始（佇列已有雛形） |
| ③ | 管理員畫框 / RBAC | 未開始 |

詳見 **`docs/ROADMAP_PROGRESS.md`**（含 2026-05-25 已完成項與第一階段待辦）。

## 下一步

WhatsApp 通道、AI 翻譯、shapefile 匯出、大規模壓測，見 `docs/MODULE_SPEC.md`。
