# 危機事件生命週期（Unspecified → Defined）

## 產品原則

災害發生當下，管理員往往**尚未**能劃定影響範圍或正式時間窗。Contributor 仍應能立即回報。

因此：

1. **回報階段**：一律先掛在 **`unspecified`（未指定事件）** 的 `crisis_id` 下，**不**以地圖範圍限制提交。
2. **管理階段**（之後）：管理員劃定 `bounds`（參考 AOI）與回報時間窗 `starts_at` / `ends_at`。
3. **顯示階段**（之後）：地圖／儀表板依「官方窗口＋範圍」**篩選顯示**；回報資料可事後用時空關聯歸檔，**不要求**民眾當下選對事件。

## 名詞對照

| 名稱 | 含義 |
|------|------|
| `crisis_id` | 資料庫裡「事件桶」ID；初期固定為 **unspecified** 那一筆 |
| `crises.bounds` | 管理員**事後**畫的參考多邊形；`NULL` = 尚未劃定 |
| `reporting_phase` | API 回傳：`unspecified`（無 bounds）或 `defined`（已有參考範圍） |
| 表單 `crisis_types` | 回報人**自填**的災害類型（地震、水災等），與 `crisis_id` 無關 |

## 現行實作（MVP）

- 種子／預設危機：`slug = unspecified`，`bounds = NULL`。
- `GET /v1/public/active-window`：`reporting_unbounded: true`，`reporting_phase: unspecified`。
- 提交 `POST /v1/reports`：**不檢查**點位是否在 bounds 內。
- 地圖：有 bounds 時可選顯示參考框（⊞）；無 bounds 時僅 GPS／點選回報。

## 後續（第三階段管理端）

- 管理員 UI：編輯 bounds、開關時間窗。
- 顯示模式：全部回報 / 僅官方窗口內 / 僅參考 AOI 內（時空 join）。
- 可選：批次將既有回報標記為「已納入正式事件」（仍保留原始 `crisis_id` 或寫入關聯表）。

## 與離線的關係

離線快照存的是當時的 `active-window`（含 `crisis_id`）。在 **unspecified** 階段，快照即「未指定事件 · 開放回報」，不要求已有 bounds。
