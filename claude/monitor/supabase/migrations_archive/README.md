# migrations_archive

2026-07-07 の CLI 運用移行（`db push` 化）で退避した、SQL Editor 手貼り時代の
migration 群（`20260519`〜`20260707`・46ファイル）。

## なぜ退避したか
本番は元々 SQL Editor 手貼りで適用しており、これらは **CLI の migration 履歴テーブルに
未登録**だった。加えて `YYYYMMDD_NNN` 命名は同日複数で Supabase のバージョン解釈が
衝突するため、個別登録は不向き。そこで現行本番スキーマを **1本の baseline**
（`../migrations/20260707090000_remote_baseline.sql`＝`db dump` 出力）に畳み込み、
以降は `bun run db:push` 運用へ移行した（手順は `docs/db-environments.md` §2）。

## 位置づけ
- **履歴の記録**としてのみ保持。`db reset` / `db push` では**再生しない**（baseline に内包済み）。
- 個別 migration の意図・差分を後から追う際の参照元。
- `tests/authz/schema.sql`（RLS 契約テスト）はこことは独立の手管理転記。

新しいスキーマ変更は `bun run db:new <名>` → `db:reset` 検証 → PR → `db push` で行う。
