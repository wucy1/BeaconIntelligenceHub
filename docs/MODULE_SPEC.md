# 危機損害回報 MVP — 模組規格書

**版本**：1.0  
**適用**：UNDP / Innocentive 類 TRL 4 原型（瀏覽器 PWA + Capacitor 輕量封裝共用程式碼）

---

## 0. 架構定案：Vite + React（推薦方案）

### 0.1 決策

| 選項 | 結論 |
|------|------|
| **Vite + React（採用）** | 單一 SPA 產物（`dist/`），`base: './'` 可同時餵給 **靜態託管** 與 **Capacitor `webDir`**；路由僅 **React Router** 一層，無 SSR/WebView 與 Next 伺服器元件不一致問題。 |
| Next.js 僅 Web + Capacitor 共用 `src/` | 技術可行，但常需 **static export**、謹慎處理動態路由與資源路徑；App Router 與 Capacitor 除錯成本高，**不符合「盡早定案、避免雙重路由」** 的 MVP 目標。 |

### 0.2 技術棧總覽

| 層 | 技術 |
|----|------|
| 前端 | **Vite 5+**、**React 18+**、**TypeScript**、**React Router 6** |
| 行動封裝 | **Capacitor 6+**（`webDir: dist`） |
| PWA | **vite-plugin-pwa**（Workbox）；僅快取殼與靜態資源；**業務資料以自管佇列為主** |
| 地圖 | **MapLibre GL JS**；示範區 footprint 為 **GeoJSON** |
| 本機儲存 | **抽象層 `LocalStore`**：原生 **SQLite**（Capacitor）、瀏覽器 **IndexedDB**（idb 或 Dexie） |
| 後端 API | **FastAPI**（建議）或 Node；**OpenAPI** 維護合約 |
| 資料庫 | **PostgreSQL + PostGIS** |
| 物件儲存 | **S3 相容**（如 Cloudflare R2）；**Presigned PUT** |
| 部署（原型） | 前端：Cloudflare Pages / Vercel（靜態）；API + DB：Render / Railway / Fly 等 |

### 0.3 產物結構（建議目錄）

```
apps/
  mobile/          # Capacitor 專案（cap sync 指向 web dist）
  web/             # 可選：僅 capacitor.config / 沒必要可分開
packages/
  app/             # Vite React 主應用（報告端 + 可選簡化儀表板同倉或分倉）
  api-contract/    # OpenAPI 產生的 TS 型別（可選）
```

*MVP 亦可單倉：`/src`、`vite.config.ts`、`capacitor.config.ts` 置於根目錄。*

---

## 1. 產品模組總覽

| 模組 ID | 名稱 | 說明 |
|---------|------|------|
| M01 | 裝置與環境 | 檢測 online/offline、Capacitor vs Web、持久化後端選擇 |
| M02 | 國際化（i18n） | 六種 UN 官方語言 UI |
| M03 | 認證與匿名 | 裝置指紋 / 匿名 `reporter_hash`、可選 JWT |
| M04 | 危機與示範 AOI | 選取 `crisis_id`、載入示範建物與邊界 |
| M05 | 地圖與建物選取 | MapLibre、footprint 點選、無 GPS/無 footprint 降級 |
| M06 | 表單與檢核 | 必填欄位、損害三級、基礎設施多選、附錄欄位 |
| M07 | 媒體擷取 | 相機/相簿、壓縮、EXIF 清除（可選）、本機檔案路徑/Blob |
| M08 | 離線佇列 | 草稿、排程、上傳、重試、狀態機 |
| M09 | 同步引擎 | Presigned 上傳 → metadata POST、衝突與 idempotency |
| M10 | 後端 API | REST、驗證、寫入 DB/R2 |
| M11 | 空間與版本 | PostGIS、`latest_report_per_building` 視圖 |
| M12 | 儀表板（檢視端） | 地圖+列表、篩選、單筆詳情、建物歷史 |
| M13 | 匯出 | CSV、GeoJSON、公開 REST JSON |
| M14 | 重複警示 | 同建物、時間接近之 heuristic |
| M15 | 隱私與安全 | TLS、最小化欄位、日誌不寫 PII |

---

## 2. 使用者角色與入口

| 角色 | 入口 | 權限（MVP） |
|------|------|-------------|
| 社區填報者 | `/` 或 `/r/:crisisSlug` | 建立本機草稿、同步報告、讀取己送上傳狀態（可選） |
| 評審/營運 | `/dashboard` 或獨立子網域 | 讀取報告列表、匯出（MVP 可用簡單 **API key** 或 **HTTP Basic**；正式再上 RBAC） |

---

## 3. 畫面與路由規格

### 3.1 填報端（Reporter）

| 路由 | 畫面 | 主要元件 | 接受條件 |
|------|------|----------|----------|
| `/` | 危機選擇 / 預設導向示範危機 | `CrisisPicker` | 至少一筆 `crises` 已種子 |
| `/r/:crisisId` | 填報首頁：進入表單 | `ReportHome` | `crisisId` 存在 |
| `/r/:crisisId/new` | 新回報精靈（可多步） | `ReportWizard` | 離線可進入；地圖 tile 依模式載入 |
| `/r/:crisisId/queue` | 離線佇列與重試 | `SyncQueue` | 列出 `pending_submissions` |
| `/r/:crisisId/success/:localId` | 已排程/已同步確認 | `ReportSuccess` | — |

**精靈步驟（建議固定順序，符合 2 分鐘 demo）：**

1. **媒體** — 拍照或選圖（M07）  
2. **損害分類** — minimal / partial / complete（M06）  
3. **地點** — 地圖點選建物 **或** GPS 點 **或** 僅文字地標（M05）  
4. **結構化表單** — 基礎設施類型、危機類型、廢墟、附錄多選等（M06）  
5. **說明** — 簡短描述 + 語言標記（使用者輸入語言）  
6. **檢閱送出** — 寫入佇列 → 觸發同步（M08–M09）

### 3.2 儀表板端（Dashboard）

| 路由 | 畫面 | 功能 |
|------|------|------|
| `/dashboard` | 總覽地圖 | 篩選：`crisis_id`、損害等級、日期、同步狀態 |
| `/dashboard/report/:id` | 報告詳情 | 圖片 signed URL、metadata、建物連結 |
| `/dashboard/building/:buildingId` | 建物時間線 | 多筆報告 + 標註「最新採用」 |
| `/dashboard/export` | 匯出 | 選格式與篩選 → 下載 |

*若單一 SPA 過大，儀表板可第二個 Vite entry（進階）；MVP 建議同應用、路由分開。*

---

## 4. 離線與同步狀態機（M08–M09）

### 4.1 本機實體：`pending_submission`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `local_id` | UUID | 客戶端主鍵 |
| `client_report_uuid` | UUID | 與伺服器 idempotency 對齊（= `reports.client_generated_uuid`） |
| `crisis_id` | string/uuid | |
| `payload_json` | JSON | 表單不含二進位 |
| `image_local_uri` | string | Capacitor `file://` 或 Web blob key |
| `thumb_local_uri` | string? | 可選 |
| `image_width` / `image_height` | int | 壓縮後 |
| `sync_status` | enum | 見下表 |
| `sync_attempt_count` | int | |
| `last_error` | string? | |
| `created_at_client` | ISO8601 | |
| `updated_at_client` | ISO8601 | |

### 4.2 `sync_status` 枚舉

```
draft | queued | uploading_image | submitting_metadata | synced | failed
```

**允許轉移：**

- `draft` → `queued`（使用者確認送出）  
- `queued` → `uploading_image`（偵測 online）  
- `uploading_image` → `submitting_metadata`（R2 PUT 成功）  
- `submitting_metadata` → `synced`（API 201）  
- 任一失敗 → `failed`（保留 `last_error`，可手動「重試」→ `queued`）  

### 4.3 同步流程（有序）

1. 若 `navigator.onLine === false`（或 Capacitor Network plugin）：僅 `queued`，UI 提示「將於連線後上傳」。  
2. **壓縮影像**（若尚未）：長邊 ≤ 2048 px、JPEG 品質 0.82（可設定常數）。  
3. `GET /v1/uploads/presign`（query：`contentType`, `checksum`, `crisisId`）→ `putUrl`, `objectKey`。  
4. `PUT putUrl`（binary）。  
5. `POST /v1/reports` body 含 `client_generated_uuid`, `object_key`, metadata…  
6. 成功：本機列標記 `synced`，可選保留 7 天後刪除。  

### 4.4 Idempotency

- Header：可選 `Idempotency-Key: {client_report_uuid}`  
- 伺服器：`(crisis_id, client_generated_uuid)` **UNIQUE**；重複 POST 回 **200** 與既有 `report_id`。

---

## 5. 後端 API 規格（M10）

**Base path**：`/v1`  
**Content-Type**：`application/json`；上傳本體走 presigned **binary**。

### 5.1 `GET /health`

回應：`{ "ok": true, "postgis": true }`

### 5.2 `GET /crises`

列表示範/啟用中危機。  
回應欄位：`id`, `slug`, `name`, `bounds`（GeoJSON Polygon 可選）, `footprint_bundle_url`（可選）

### 5.3 `GET /crises/:id/buildings`

查詢參數：`bbox=minLng,minLat,maxLng,maxLat`（可選）  
回應：`FeatureCollection`（Polygon/MultiPolygon），properties 至少含 `building_id`（UUID）

### 5.4 `GET /v1/uploads/presign`

Query：`crisisId`, `mimeType`, `checksumSha256`, `bytes`（預期大小）  
回應：`{ "putUrl", "objectKey", "expiresAt" }`

### 5.5 `POST /v1/reports`

**Body（JSON）**：

| 欄位 | 必填 | 說明 |
|------|------|------|
| `client_generated_uuid` | ✓ | UUID v4 |
| `crisis_id` | ✓ | |
| `building_id` | 建物點選時 ✓ | 無 footprint 時可 null |
| `geom` | 條件 | `Point` GeoJSON；無建物時 GPS；皆無則 null |
| `textual_location` | 無可靠座標時 ✓ | |
| `damage_level` | ✓ | `minimal` \| `partial` \| `complete` |
| `infrastructure_types` | ✓ | string[]（列舉對齊賽題） |
| `infrastructure_name` | ✓ | |
| `crisis_types` | ✓ | string[] |
| `debris_clearing_required` | ✓ | bool |
| `description` | ✓ | |
| `description_language` | ✓ | BCP-47，`ar`|`zh`|`en`|`fr`|`ru`|`es` |
| `captured_at_client` | ✓ | ISO8601 |
| `appendix_answers` | ✓ | JSON object（鍵對應附錄題） |
| `image` | ✓ | `{ "objectKey", "mimeType", "width", "height", "checksumSha256" }` |
| `reporter_fingerprint` | 可選 | 經單向處理後字串（伺服端再 hash） |

**回應 201**：`{ "report_id", "received_at_server" }`  
**回應 200**（重複）：同上 id。

### 5.6 `GET /v1/reports`

Query：`crisis_id`, `since`, `damage_level`, `bbox`, `limit`, `cursor`  
回應：`{ items: ReportSummary[], nextCursor }`

### 5.7 `GET /v1/reports/:id`

詳情（含 signed image URL 可選：`?includeImageUrl=1`）。

### 5.8 `GET /v1/buildings/:buildingId/reports`

依時間排序（新→舊）。

### 5.9 `GET /v1/export`

Query：`crisis_id`, `format=csv|geojson`, `from`, `to`  
回應：檔案串流或 presigned 下載 URL（大檔時）。

### 5.10 `GET /v1/analytics/summary`（可選 MVP）

Query：`crisis_id` → 計數 by `damage_level`。

---

## 6. 資料庫結構（M11）— PostgreSQL + PostGIS

### 6.1 DDL（核心）

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE crises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name JSONB NOT NULL,  -- { "en": "...", "zh": "...", ... } 可簡化 MVP 僅 en
  bounds GEOMETRY(Polygon, 4326),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crisis_id UUID NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  external_ref TEXT,
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON buildings USING GIST (geom);
CREATE INDEX ON buildings (crisis_id);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_generated_uuid UUID NOT NULL,
  crisis_id UUID NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  building_id UUID REFERENCES buildings(id),
  geom GEOMETRY(Point, 4326),
  textual_location TEXT,
  damage_level TEXT NOT NULL CHECK (damage_level IN ('minimal','partial','complete')),
  infrastructure_types TEXT[] NOT NULL,
  infrastructure_name TEXT NOT NULL,
  crisis_types TEXT[] NOT NULL,
  debris_clearing_required BOOLEAN NOT NULL,
  description TEXT NOT NULL,
  description_language TEXT NOT NULL,
  appendix_answers JSONB NOT NULL DEFAULT '{}',
  captured_at_client TIMESTAMPTZ NOT NULL,
  received_at_server TIMESTAMPTZ NOT NULL DEFAULT now(),
  reporter_hash TEXT,
  duplicate_of UUID REFERENCES reports(id),
  UNIQUE (crisis_id, client_generated_uuid)
);
CREATE INDEX ON reports (crisis_id, received_at_server DESC);
CREATE INDEX ON reports (building_id, received_at_server DESC);

CREATE TABLE report_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  thumb_object_key TEXT,
  mime_type TEXT NOT NULL,
  width INT,
  height INT,
  checksum_sha256 TEXT NOT NULL
);
```

### 6.2 「每建物最新一筆」視圖

```sql
CREATE OR REPLACE VIEW latest_report_per_building AS
SELECT DISTINCT ON (building_id)
  r.*
FROM reports r
WHERE r.building_id IS NOT NULL
ORDER BY r.building_id, r.captured_at_client DESC, r.received_at_server DESC;
```

*無 `building_id` 之報告（純 GPS/文字）不納入此視圖；儀表板可以另一規則顯示「未綁建物」點位。*

---

## 7. 本機儲存抽象層（M01 + M08）

### 7.1 介面 `LocalStore`

```typescript
interface LocalStore {
  putSubmission(row: PendingSubmission): Promise<void>;
  getSubmission(localId: string): Promise<PendingSubmission | null>;
  listPending(): Promise<PendingSubmission[]>;
  updateStatus(localId: string, patch: Partial<PendingSubmission>): Promise<void>;
  deleteSubmission(localId: string): Promise<void>;
}
```

### 7.2 實作

- **Capacitor**：SQLite 表 `pending_submissions`（欄位同 §4.1）。  
- **Web**：IndexedDB object store `pending_submissions`，key `local_id`。

### 7.3 地圖離線 bundle

- 示範 GeoJSON 路徑：`/assets/demo/footprints.json`（建置時 copy 到 `public/`）。  
- 線上模式可改從 `GET /crises/:id/buildings?bbox=...` 增量載入（MVP 可先單檔）。

---

## 8. 地圖模組（M05）

### 8.1 線上

- 底圖：公開 raster或 vector（遵守 ToS）；示範可用 OpenFreeMap / OSM。  
- 疊加：`buildings` GeoJSON，fill-outline，點選設 `selectedBuildingId`。

### 8.2 離線

- 讀取內嵌 `footprints.json`；底圖 **可降級**為簡單色塊或低解析靜態圖（可選），**須**在規格中註明「TRL 4 僅示範 AOI」。  

### 8.3 降級順序（與賽題對齊）

1. 使用者點選 footprint → `building_id` + 可選幾何中心點  
2. 若無 footprint：瀏覽器 Geolocation → `geom` Point  
3. 若無 GPS：**必填** `textual_location`（+ 可選手動圖上點 approximate）  

---

## 9. 表單與列舉（M06）

### 9.1 損害三級

- `minimal` — 輕微／無結構損害  
- `partial` — 部分損害仍可用  
- `complete` — 嚴重毀損或不可用  

### 9.2 基礎設施類型（多選，對齊賽題）

`residential`, `commercial`, `government`, `utility`, `transport_communication`, `community`, `public_recreation`, `other`（`other` 時必填文字）

### 9.3 危機類型（多選）

自然：`earthquake`, `flood`, `tsunami`, `hurricane_cyclone`, `wildfire`  
技術：`explosion`, `chemical`  
人為：`conflict`, `civil_unrest`

### 9.4 附錄题（JSON 鍵建議）

- `electricity_condition`  
- `health_services`  
- `pressing_needs`（string array）

---

## 10. 國際化（M02）

| 語言代碼 | 語言 |
|----------|------|
| `ar` | Arabic（RTL） |
| `zh` | Chinese |
| `en` | English（預設後備） |
| `fr` | French |
| `ru` | Russian |
| `es` | Spanish |

- UI 字串：**靜態 JSON** 六份，`react-i18next` 或 `i18next`。  
- **RTL**：`document.dir = 'rtl'` 當 `ar`。  
- 使用者 **描述語言** 由使用者於表單選擇或依輸入 locale 推斷；**不要求** MVP 自動雙向機譯。

---

## 11. 匯出模組（M13）

### 11.1 CSV

- UTF-8、首列標題：對應 `reports` 扁平化欄位 + `lon` `lat`（由 `geom` 抽出）。  
- `infrastructure_types` / `crisis_types` 以 `|` 連接。

### 11.2 GeoJSON

- `FeatureCollection`；每筆 `geometry` 優先 `reports.geom`，否則 `buildings.geom` 中心（若可選）。

### 11.3 REST

- `GET /v1/reports` 已滿足 JSON 整合；文件載明分頁與篩選。

---

## 12. 重複偵測（M14）— MVP 啟發式

- 條件：`building_id` 相同 且 `abs(received_at_server 差) < 10 分鐘` 且 **同一 `reporter_hash`**（若無 hash 則僅前兩項）。  
- 行為：第二筆 `duplicate_of` 指向前筆 **或** 僅儀表板 **warning flag**（择一實作，建議後者減少寫入複雜度）。

---

## 13. 安全與隱私（M15）

| 項目 | 規格 |
|------|------|
| 傳輸 | 全站 HTTPS |
| 影像 | R2 private bucket；儀表板用 **短期 signed GET** |
| EXIF | 上傳前可選 **strip**（Web：canvas 重編碼；Native：壓縮流程一併移除） |
| 身分 | `reporter_hash = SHA256( device_id + server_salt )`（salt 僅伺服端） |
| 日誌 | 不記錄 `description` 全文於應用程式 log |
| 儀表板 | MVP：強密碼保護路徑或 API key；README 提供評審帳密 |

---

## 14. 建置與部署矩陣

| 目標 | 指令 / 設定 |
|------|-------------|
| Web 開發 | `pnpm dev`（Vite） |
| Web 正式 | `pnpm build` → `dist/` |
| Capacitor | `pnpm build && npx cap sync`；`webDir: 'dist'`、`server.url` 開發時可指本機 |
| PWA | `vite-plugin-pwa` registerType `autoUpdate`；**勿**將大量圖片納入 precache |

---

## 15. 測試驗收清單（與交件對齊）

- [ ] 瀏覽器：首次載入後可完成一筆**線上**回報並在儀表板看到。  
- [ ] 飛航/離線：完成一筆排程，恢復網路後 **自動或手動同步成功**。  
- [ ] Capacitor：同上（若團隊有裝置）。  
- [ ] 地圖：示範區 footprint 點選綁 `building_id`。  
- [ ] 無 GPS：僅文字地標仍可 `queued`。  
- [ ] 匯出：CSV + GeoJSON 下載內容與 DB 一致。  
- [ ] 建物多筆：儀表板顯示時間序，且視圖/標籤顯示「最新」。  
- [ ] 六語：UI 切換無版面錯亂；`ar` RTL。  

---

## 16. 開發排程與依賴（參照路線圖）

| 週 | 重點 | 交付 |
|----|------|------|
| 0 | 定 AOI、footprint、OpenAPI 初稿、LocalStore 介面 | 種子 SQL + GeoJSON |
| 1 | API + DB + R2 presign + 線上回報 + 儀表板讀取 | E2E 線上 |
| 2 | 佇列 + 壓縮 + 同步狀態機 + PWA 殼 | 離線 demo |
| 3 | 版本視圖、篩選、重複警示、六語 | UX 完整 |
| 4 | 安全硬化、種子、2 分鐘影片、評審 README | 交件包 |

---

## 文件結尾

**定案**：**Vite + React + Capacitor + FastAPI + PostGIS + R2**，單一路由與單一 `dist` 產線，符合「一程式碼、雙進入方式」之 MVP。若後續需 SEO 或 SSR 再行評估是否增量引入 Next（僅限獨立行銷站），**不**與 Capacitor 共用路由層。
