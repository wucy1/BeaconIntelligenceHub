# 營運地圖：工作模式 vs 檢視模式

`/ops/map` 頂部可在 **工作（Work）** 與 **檢視（Browse）** 之間切換。兩者共用同一張地圖，但**時間範圍、分區範圍與標記著色**的語意不同。混用會導致「有計數卻看不到 pin」或「歸檔預覽與地圖不一致」等問題。

## 快速對照

| | **工作 Work** | **檢視 Browse** |
|---|---------------|-------------------|
| **目的** | 畫／調分區、執行危機歸檔 | 分析切片、核對結果、儲存報表 |
| **時間** | 僅 **官方歸檔時間窗**（`archive_window_start/end`） | **查詢起迄**（URL `browse_from` / `browse_to`） |
| **空間** | 工作危機的 **全部分區** | 可選分區（`zone_id`）與視角（`view`） |
| **地圖標記 API** | `view=all`，分區內候選 **＋ 已連結此危機的回報**（官方時間窗） | 依 `view`：`all` / `unspecified` / `crisis` |
| **歸檔連結著色** | 永遠顯示（linked / candidate / other） | 僅 `view=all` 且已選危機時顯示 |
| **分區點擊篩選** | 否（避免誤改歸檔範圍） | 是（Browse 下可點分區縮小切片） |

**紅線：** 檢視模式的查詢時間 **不會** 改變工作模式的歸檔範圍；工作模式地圖標記 **一律** 使用官方時間窗，不得與 Browse URL 時間混用。

## 工作模式（Work）

1. 選 **工作危機**（底欄）：決定要畫分區與歸檔的危機。
2. 底欄顯示 **官方時間窗**（唯讀）；未設定時提示先於「危機歸檔」面板設定。
3. 地圖載入該危機 **所有分區內**（GPS 或建物 footprint 與分區相交）、且落在官方時間窗內的回報。時間窗解讀與前台相同（`effective_capture_window`：官方起日未到時仍用滾動區間；無結束日則至現在）。**不含**僅因 `building.crisis_id` 掛名卻不在分區內的回報（歸檔預覽仍可能計入）。
4. 標記著色：
   - **實心**：已連結此工作危機
   - **紫虛線**：在範圍內、尚未連結（候選）
   - **橘框**：已連結其他危機
5. 右側：**＋ 畫分區**、**危機歸檔**、人員、稽核等作業入口。

若官方時間窗尚未設定，工作模式會暫時 fallback 至 Browse 查詢時間（僅供開發／過渡；正式作業應先設定官方窗）。

## 檢視模式（Browse）

1. 使用 URL／底欄的 **browse_from / browse_to** 與 **view**、**zone_id**、**crisis_id** 組成分析切片。
2. 查詢時間僅供檢視（細節見回報數旁的 `?`，不常駐於底欄以免佔用手機地圖空間）。
3. 視角說明：
   - **全部（all）**：切片內所有回報；有選危機時才套用歸檔連結著色
   - **未歸檔（unspecified）**：切片內尚未連結任何進行中危機
   - **已歸檔（crisis）**：切片內已連結至所選危機
4. 可 **儲存報表**、從 Dashboard 帶入相同 Browse 參數。

## 危機歸檔面板與時間

- **官方時間窗**：歸檔預覽與執行、**以及工作模式地圖標記** 的唯一時間依據。
- 若 Browse URL 時間與官方窗不同，歸檔面板會顯示警告；地圖在 **工作** 下仍用官方窗，在 **檢視** 下用 Browse 時間。

相關後端與歸檔語意見 [`CLASSIFICATION_AND_ZONES.md`](./CLASSIFICATION_AND_ZONES.md)。

## URL 參數

| 參數 | 用途 |
|------|------|
| `view` | `all` \| `unspecified` \| `crisis`（Browse 視角） |
| `crisis_id` | 檢視「已歸檔」或著色脈絡時的危機 |
| `zone_id` | Browse 可選分區篩選 |
| `browse_from` / `browse_to` | ISO 時間；Browse 查詢範圍 |
| `report_id` / `lat` / `lng` | 深連結至單一回報 |

工作危機與 shell 模式（work / browse）由前端狀態與 localStorage 管理，不一定反映在 URL。

## 實作參考

- `frontend/src/ops/opsBrowseParams.ts` — `captureRangeForOpsMap()`：Work → 官方窗；Browse → `browseRangeToApi()`
- `frontend/src/pages/OpsMapPage.tsx` — `showArchiveLinkStyles`、分區點擊僅 Browse
- `frontend/src/components/map/MapViewWatcher.tsx` — Ops 地圖視野持久化（`bih-map-center:ops`）

## 常見問題

**Q：已歸檔 1 筆，前台有 pin、後台 Work 沒有？**  
1. 舊版地圖 API 只查「分區內」、不含 `report_crisis_links` 已連結列；歸檔若用較寬規則，會出現歸檔有、地圖無。  
2. 舊版 Work 時間窗若只用 raw `archive_window_start`，可能比前台 `effective_capture_window` 窄。  
3. 地圖 auto-fit 若在回報載入前跑完，可能沒把 pin 納入視野（已改為回報載入後重 fit）。

**Q：工作模式有數字但地圖沒 pin？**

**Q：重新整理後地圖跳回台北？**  
應已透過 `bih-map-center:ops` 記住上次視野；若無紀錄則使用預設中心。

**Q：改了 Browse 時間，歸檔預覽沒變？**  
預期行為：歸檔只看官方窗。請在工作模式核對標記，或在歸檔面板調整官方窗。
