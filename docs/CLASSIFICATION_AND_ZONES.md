# 分階層管理與營運分區（Phase 3）

## 產品原則

| 原則 | 說明 |
|------|------|
| 危機生命週期 | **不影響** Contributor 能否回報；`archive_status` 僅供事後歸檔 |
| 危機 | 事後歸檔桶；多危機可並存、空間可重疊（3b：`report_crisis_links`） |
| 分區 (zones) | 營運人員**手畫框**（可巢狀 `parent_zone_id`），非官方區劃 |
| 角色 | `coordinator`（分區視野）< `crisis_lead` ≈ `system_admin`（全分區） |
| 離線 | 上傳不綁危機；歸檔依時空規則事後處理 |
| 認證 | 帳密 + JWT（`/v1/ops/auth/login`） |

## Phase 3a（本版）

- Migration `006_ops_zones_users.sql`：`zones`、`ops_users`、`user_zone_assignments`、危機歸檔欄位
- API：`/v1/ops/*`（登入、分區 CRUD、分區篩選回報）
- 前端：`/ops/login`、`/ops/zones`、儀表板分區篩選（已登入時）

### 角色與可見範圍

| 角色 | 分區列表 | 建立/刪除分區 | 回報列表 |
|------|----------|---------------|----------|
| coordinator | 僅指派分區 | ✗ | 僅指派分區內（PostGIS intersect） |
| crisis_lead | 全部 | ✓ | 全部（可選 `zone_id` 篩選） |
| system_admin | 全部 | ✓ | 全部 |

### 首次建立管理員

1. 在 `backend/.env` 設定 `OPS_JWT_SECRET`、`OPS_BOOTSTRAP_PASSWORD`（可選 `OPS_BOOTSTRAP_EMAIL`）
2. 執行 migration 006
3. `python scripts/bootstrap_ops_admin.py` 或 `POST /v1/ops/bootstrap-admin`

### Coordinator 指派

`POST /v1/ops/users/{user_id}/zones/{zone_id}`（需 crisis_lead 或 system_admin）

## Phase 3b（規劃）

- `report_crisis_links`、多危機批次歸檔
- `reports.crisis_id` 可改為可空（離線佇列不綁危機）

## Phase 3c（規劃）

- 歸檔預覽、稽核 log
