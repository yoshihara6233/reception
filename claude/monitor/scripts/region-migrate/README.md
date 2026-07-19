# Recording Monitor — リージョン移行 runbook（Mumbai → Tokyo）

対象: Supabase `jmlviywilxzavjbmlpnf`（ap-south-1 / Mumbai）→ 新プロジェクト（ap-northeast-1 / Tokyo）。
Supabase はリージョンの「その場変更」不可のため、新プロジェクトへ全移行する。

反映が必要な場所は3つだけ: **Vercel env / エッジ実機 .env / 新プロジェクトの Vault・Function secrets**。
アプリの Vercel cron（vercel.json）はアプリに付いてくるので変更不要。

---

## 0. 前提

- Free プランは同時2プロジェクトまで。先に不要プロジェクト（旧 baggage 用 `rurejtbijeuvdaevjolb`）を削除して枠を空ける。
- 移行中のエッジ発報はエッジ側スプールが再送するため欠損しにくいが、切替は営業時間外推奨。

## 1. Tokyo プロジェクト作成（ダッシュボード）

- New project → Name: `Recording Monitor Tokyo` / Region: **Northeast Asia (Tokyo)**
- DB パスワードを保存し、**新 ref**（20文字）を控える。

## 2. DB 移行（スキーマ＋データ＋auth ユーザー）

ローカルで（両方の DB パスワードが必要。履歴に残さないよう read -s を使う）:

```bash
mkdir -p /tmp/mig && cd /tmp/mig

# 接続文字列（session pooler・港5432）
read -s "OLDPW?old DB password: "; echo
read -s "NEWPW?new DB password: "; echo
OLD="postgresql://postgres.jmlviywilxzavjbmlpnf:${OLDPW}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"
NEW="postgresql://postgres.<新ref>:${NEWPW}@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

# 公式手順どおり 3 分割 dump（roles / schema / data。auth.users のPWハッシュも含まれる）
supabase db dump --db-url "$OLD" -f roles.sql  --role-only
supabase db dump --db-url "$OLD" -f schema.sql
supabase db dump --db-url "$OLD" -f data.sql   --use-copy --data-only

# 新プロジェクトへ restore
psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -d "$NEW"
psql --single-transaction -v ON_ERROR_STOP=1 \
  -c 'SET session_replication_role = replica' -f data.sql -d "$NEW"
```

## 3. pg_cron ジョブ＋Vault の再設定（新プロジェクトの SQL Editor）

pg_cron のジョブ定義と Vault secrets は dump に**含まれない**ため手動再作成。

まず旧プロジェクトの SQL Editor で現行ジョブを確認:

```sql
SELECT jobname, schedule, command FROM cron.job;
```

新プロジェクトで pg_cron / pg_net を有効化（Database → Extensions）後、
同じ `cron.schedule(...)` を再実行（jalert-poller / bcp_report の invoke 系）。

Vault（Project Settings → Vault）に新プロジェクトの値で登録:
- `project_url` = `https://<新ref>.supabase.co`
- `service_role_key` = 新プロジェクトの service_role (secret) key

## 4. Storage オブジェクト移行

```bash
cd <repo>/claude/monitor
export OLD_SUPABASE_URL="https://jmlviywilxzavjbmlpnf.supabase.co"
export OLD_SERVICE_ROLE_KEY="<旧 secret key>"
export NEW_SUPABASE_URL="https://<新ref>.supabase.co"
export NEW_SERVICE_ROLE_KEY="<新 secret key>"
node scripts/region-migrate/copy-storage.mjs --dry-run   # まず件数確認
node scripts/region-migrate/copy-storage.mjs             # 本コピー
```

## 5. Edge Function（jalert-poller）

```bash
cd <repo>/claude/monitor
supabase functions deploy jalert-poller --project-ref <新ref>
supabase secrets set --project-ref <新ref> \
  RESEND_API_KEY=<値> \
  NEXT_PUBLIC_APP_URL=https://intereco-monitor.vercel.app
```

（SUPABASE_URL / SERVICE_ROLE_KEY はプラットフォームが自動注入）

## 6. Vercel env 切替（intereco-monitor）

Settings → Environment Variables を新プロジェクト値に差替 → Redeploy:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://<新ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = 新 publishable key
- `SUPABASE_SERVICE_ROLE_KEY` = 新 secret key（Sensitive）

## 7. エッジ実機 .env（on-box・ユーザー作業）

⚠ これを忘れると heartbeat/grid/snapshot が全停止する（鍵ローテ時と同じ）。

```bash
sudo nano /home/intereco/intereco/claude/edge-agent/.env
#   SUPABASE_URL=https://<新ref>.supabase.co
#   SUPABASE_ANON_KEY=<新 publishable>
#   SUPABASE_SERVICE_ROLE_KEY=<新 secret>
sudo systemctl restart intereco-edge
journalctl -u intereco-edge -n 20 --no-pager   # heartbeat 成功を確認
```

## 8. 動作検証チェックリスト

- [ ] 管理画面ログイン（既存ユーザー・既存PWのまま入れる = auth 移行成功）
- [ ] エッジ heartbeat が新DBに到着（admin → エッジ一覧の last_seen 更新）
- [ ] 16分割グリッド・単カメラライブ表示
- [ ] アラーム発報テスト → alarm_events 記録・メール
- [ ] BCP: /bcp/jalerts 表示・jalert-poller ログ（Functions → Logs）
- [ ] 過去スナップ/レポートが開ける（Storage 移行確認）

## 9. 後片付け

- 旧 Mumbai プロジェクトを **Pause**（即削除しない — 1週間程度の切り戻し猶予）
- 問題なければ削除。CLAUDE.md / memory / intereco-patterns の project-ref 記述を更新。
