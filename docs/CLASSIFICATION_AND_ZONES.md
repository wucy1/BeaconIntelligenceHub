# 分階層管理與營運分區（Phase 3）

## 產品原則

| 原則 | 說明 |
|------|------|
| 危機生命週期 | **不影響** Contributor 能否回報；`archive_status` 僅供事後歸檔 |
| 危機 | 事後歸檔桶；多危機可並存、空間可重疊（`report_crisis_links`） |
| 分區 (zones) | 營運人員**手畫多邊形**（可巢狀 `parent_zone_id`），非官方區劃 |
| 角色 | `coordinator`（分區視野）< `crisis_lead` ≈ `system_admin`（全分區） |
| 離線 | 上傳不綁危機；歸檔依時空規則事後處理 |
| 認證 | 帳密 + JWT（`/v1/ops/auth/login`） |
| 後台 UI | **Map first**：`/ops/map` 全螢幕地圖，操作以浮動卡片／tooltip 呈現 |

## Phase 3a（完成）

- Migration `006`：zones、ops_users、user_zone_assignments
- 任意多邊形畫區、編輯邊界、刪除
- 地圖上顯示回報點、分區篩選、時間篩選
- 回報審核／旗標（點選 marker 浮卡）

## Phase 3b（完成）

- Migration `007`：`report_crisis_links`
- 危機 `archive_window_start/end` 時間定義（營運地圖「危機歸檔」面板）
- `POST /v1/ops/crises/{id}/archive-preview` — 預覽符合時空規則的回報
- `POST /v1/ops/crises/{id}/archive-run` — 批次寫入 `report_crisis_links`
- Contributor 原始 `reports.crisis_id` 不變；連結表為事後分類

## Phase 3c（完成）

- `ops_audit_log` 表
- `GET /v1/ops/audit-log` — 稽核列表（營運地圖「稽核」面板）
- 分區 CRUD、危機更新、歸檔執行、回報審核皆寫入稽核

## 入口

| 路徑 | 說明 |
|------|------|
| `/ops/login` | 登入 |
| `/ops/map` | **營運主畫面**（map first） |
| `/ops/zones` | 導向 `/ops/map` |

## 營運地圖操作摘要

1. **畫分區**：右側「＋ 畫分區」→ 點地圖頂點 → 完成 → 儲存
2. **編輯**：點選紅框分區 → 浮卡「編輯邊界」→ 調整頂點 → 儲存
3. **回報**：彩色圓點；點選可審核／旗標；左下可設時間篩選
4. **危機歸檔**：選危機、設時間窗 → 預覽 → 執行歸檔
5. **稽核**：檢視近期操作紀錄

## Migrations

1. `006_ops_zones_users.sql`
2. `007_archive_links_audit.sql`
