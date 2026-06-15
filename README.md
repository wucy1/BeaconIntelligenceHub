# Beacon Intelligence Hub (BIH)

**Maintainer:** BIH Team · [info@crointel.com](mailto:info@crointel.com)

Community damage reporting and operations review for UNDP-style rapid assessment workflows. The product is **map-first for contributors** and **role-based for staff** (crisis leads, coordinators, system administrators).

## What works today (demo-ready)

| Area | Features |
|------|----------|
| **Contributor map** | Leaflet + OSM, report anywhere, photo upload (presign → R2 or local storage), UNDP questionnaire, device-scoped edit/delete, offline queue (PWA) |
| **Operations console** | Staff login (JWT), crisis lifecycle, team & zone assignments, audit log |
| **Operations map** | **Work** mode: draw zones, set official archive window, batch archive · **Browse** mode: query filters, save named reports |
| **Dashboard** | Tabs: **Official archive** (auto-loaded from crisis window) and **Saved queries** (from ops map); review queue, batch review, CSV/GeoJSON export |
| **Admin** | Legacy token API at `/admin` (optional `ADMIN_TOKEN`) |
| **i18n** | UI default English; bundles for EN, 繁中, 简体, DE, PT, AR, FR, RU, ES |

## Architecture

| Component | Typical hosting |
|-----------|-----------------|
| Web UI | Cloudflare Pages or Workers (`frontend/dist`) |
| API | FastAPI on Render / Fly.io / Railway |
| Database | Neon Postgres + PostGIS |
| Images | Cloudflare R2 (S3-compatible presigned PUT/GET) |

See **`docs/DEPLOYMENT.md`** for environment variables, R2 CORS, and Cloudflare build settings.

## Local development

### Prerequisites

- Docker Desktop (PostGIS for local DB)
- Python 3.12+
- Node.js 22+

### 1. Database

```powershell
cd d:\Cursor-Projects\BeaconIntelligenceHub
docker compose up -d
```

First start runs `backend/db/init.sql` (schema, default **unspecified** open-reporting crisis, sample footprints).

For Neon or other hosted Postgres, run `CREATE EXTENSION IF NOT EXISTS postgis;` then apply `init.sql` and migrations in `backend/db/migrations/` (001–015).

### 2. API

```powershell
cd backend
python -m pip install -r requirements.txt
$env:DATABASE_URL = "postgresql+psycopg2://crisis:crisis@127.0.0.1:5432/crisis"
$env:PUBLIC_BASE_URL = "http://127.0.0.1:8000"
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- Health: <http://127.0.0.1:8000/health>
- OpenAPI: <http://127.0.0.1:8000/docs>
- Local uploads: `backend/storage/` (when R2 is not configured)

Bootstrap the first ops admin (once):

```powershell
$env:OPS_BOOTSTRAP_EMAIL = "admin@bih.local"
$env:OPS_BOOTSTRAP_PASSWORD = "change-me"
# POST /v1/ops/bootstrap-admin or use scripts/bootstrap_ops_admin.py
```

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173/>. Vite proxies `/v1` and `/health` to port 8000.

## Demo / tester notes

When testing the hosted demo:

1. **API cold start** — Render free tier may need **30–60 seconds** after sleep; the ops console shows a reconnect banner when enabled in org settings.
2. **Neon migrations** — Apply all files in `backend/db/migrations/` through **`015_saved_report_zone_snapshots.sql`** before testing saved query reports or profile locale.
3. **Contributor flow** — Open the public map → place a pin → submit with photo → confirm marker appears.
4. **Staff flow** — Log in → operations console → create/activate crisis → draw zones on ops map → run archive → save a browse query → open dashboard **Saved queries** tab.
5. **R2** — Without `R2_*` vars, uploads use local storage on the API host (fine for local dev only).

## Key routes

| Route | Audience |
|-------|----------|
| `/` | Contributor map |
| `/ops/login` | Staff login |
| `/ops` | Operations console |
| `/ops/map` | Operations map (work / browse) |
| `/dashboard` | Review dashboard |
| `/admin` | Token-based admin (legacy) |

## Tech stack

- **Frontend:** Vite, React 19, TypeScript, Leaflet, MapLibre (legacy views), PWA
- **Backend:** FastAPI, SQLAlchemy, GeoAlchemy2, PostGIS
- **Storage:** Local directory or Cloudflare R2

## i18n maintenance

English (`en.json`) is the source of truth for **keys**. Each locale file must contain real translations — missing keys fall back to English at runtime only.

```powershell
cd frontend
python scripts/sync-i18n.py              # validate key parity (does not copy English)
python scripts/sync-i18n.py --regenerate-zh   # rebuild Simplified Chinese from zh-Hant (OpenCC)
```

Do **not** use `--fill-english` for release builds; it only scaffolds missing keys during development.

## Documentation

| Doc | Topic |
|-----|-------|
| `docs/DEPLOYMENT.md` | Cloudflare, Neon, R2, env vars |
| `docs/CRISIS_LIFECYCLE.md` | Draft → active → archived |
| `docs/CLASSIFICATION_AND_ZONES.md` | Zones, archive links, auto-classify |
| `docs/OFFLINE.md` | PWA offline map & sync |
| `docs/ROADMAP_PROGRESS.md` | Phase status and next milestones |
| `docs/tutorial.md` | Walkthrough |

## Sample IDs (local seed)

- Crisis: `a0000000-0000-0000-0000-000000000001`
- Buildings: `b0000000-0000-0000-0000-000000000001` … `000003`

## License / contact

For deployment support or demo feedback, contact [info@crointel.com](mailto:info@crointel.com).
