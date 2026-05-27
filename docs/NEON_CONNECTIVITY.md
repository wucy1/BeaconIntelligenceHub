# Neon 本機連線疑難排解

## 症狀

- `timeout expired`（多個 AWS IP 都逾時）
- `server closed the connection unexpectedly`

字串正確時，多半是 **本機網路 ↔ Neon (us-east-1:5432)** 路徑有問題，不是應用程式 bug。

## 請先確認（Neon Console）

1. 專案狀態為 **Active**（非 Suspended / 額度用盡）。
2. **SQL Editor** 能執行 `SELECT 1`（代表 Neon 端正常）。
3. **Project settings → IP Allow**：若已啟用，加入你目前的公網 IP，或開發期暫時允許 `0.0.0.0/0`。
4. 連線字串用 **Pooled**（主機名含 `-pooler`），並含 `sslmode=require`。
5. 建議格式（從 Console 複製後只改前綴）：

   `postgresql+psycopg2://帳號:密碼@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`

6. 在 SQL Editor 執行 `backend/db/init.sql`（新庫）與 migration。

## 本機測試

```powershell
cd backend
python scripts\check_db.py
```

PowerShell 測 TCP（僅代表埠是否通，不代表 Postgres 登入成功）：

```powershell
Test-NetConnection -ComputerName ep-你的主機-pooler.region.aws.neon.tech -Port 5432
```

## 若仍 timeout / connection closed

| 作法 | 說明 |
|------|------|
| 換網路 | 手機熱點、家用網路；公司防火牆常擋 **出站 5432** |
| VPN | 連到可存取 AWS 的節點後再跑 `check_db.py` |
| 試 Direct 主機 | Console 關閉 pooling，改用**不含** `-pooler` 的主機名（僅除錯用） |
| 重設 DB 密碼 | Console 重設 password，更新 `.env` 整行 `DATABASE_URL` |
| **開發改本機 DB** | `docker compose up -d`，`.env` 用 `127.0.0.1:5432`（見 `DEPLOYMENT.md`） |

上線時 API 跑在 Fly/Railway/Render，通常可正常連 Neon；本機開發不必強制走 Neon。
