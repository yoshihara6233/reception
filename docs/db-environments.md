# DB 環境分離 & migration 運用（Phase A / 環境分離）

対象: `claude/monitor`（Supabase）。本書は **dev / CI / prod の3環境を分離**し、migration を
SQL Editor 手貼りから **supabase CLI(`db push`)運用**へ移行するための手順書。

---

## 0. 全体像

| 環境 | DB | 用途 | 本番に触るか |
|------|----|------|------------|
| **local (dev)** | ローカル Supabase スタック（`supabase start`・Docker/OrbStack） | アプリのローカル開発 | ❌ 触らない |
| **CI** | エフェメラル Postgres（GitHub Actions service）| typecheck/build/unit/authz | ❌ 触らない（build は placeholder env） |
| **prod** | Supabase `jmlviywilxzavjbmlpnf` | 本番 | ✅ デプロイ & migration のみ |

**現状の達成度**:
- ✅ CI は本番から完全隔離済み（build=placeholder env、authz=ephemeral postgres）。
- ⚠ local は今まで `.env.local` が placeholder で**アプリをローカル起動できなかった** → 本書で解消。
- ⚠ migration は SQL Editor 手貼り（過去にラベル混入・列名上書き等の事故）→ `db push` 化で解消。

> 方針判断（2026-06-21）: フル staging クラウドプロジェクトは作らず、**ローカルDB(軽量・コストゼロ)** で
> dev を隔離。migration は **CLI linked + `db push`**。

---

## 1. 前提ツール

- supabase CLI（導入済: `supabase --version` → 2.107.0）
- Docker ランタイム（OrbStack 推奨・導入済）。`supabase start` 前に OrbStack を起動しておく。

`package.json` に CLI ラッパを用意済み（`claude/monitor` で実行）:

```
bun run db:start    # ローカルスタック起動
bun run db:stop     # 停止
bun run db:status   # ローカルの URL / キーを表示
bun run db:reset    # ローカルDBを migrations + seed で作り直す
bun run db:new <名> # 新しい空の migration ファイルを作る
bun run db:diff     # ローカルのスキーマ変更から migration を生成
bun run db:lint     # スキーマ静的検査
bun run db:pull     # 【本番接続】現行スキーマを baseline として取得
bun run db:push     # 【本番接続】未適用 migration を本番へ適用
```

---

## 2. 【一度きり】本番を CLI 運用に切替（あなたの端末で実行）

> 🔒 **DB パスワードはあなたの端末でのみ入力**。チャットや commit に貼らない。CLI はパスワードを
> `supabase/.temp/`（gitignore 済）にしか置かない。

### 2-1. ログイン & リンク
```bash
cd claude/monitor
supabase login                                   # ブラウザでアクセストークン発行
supabase link --project-ref jmlviywilxzavjbmlpnf # DB パスワードを聞かれる(本番のDB password)
```

> リンク後、`SHOW server_version;` を本番 SQL Editor で実行し、`supabase/config.toml` の
> `major_version` を一致させる（既定 17。15 なら 15 に変更）。

### 2-2. 履歴の突合わせ（2026-07-07 実施の実手順）
本番は SQL Editor 手貼りで適用してきたため、**日付付き46ファイルは CLI の migration
履歴テーブルに未登録**。さらに Remote 履歴には monitor 以前の**亡霊エントリ `0000〜0012`**
（ローカルにファイル無し）が残っていた。`supabase migration list` はこの不一致を表示する。

まず**亡霊を履歴から除去**（メタデータのみ・スキーマは無変更）:
```bash
supabase migration repair --status reverted 0000 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012
supabase migration list   # 上段 0000〜0012 が消えたことを確認
```

> ⚠ `db pull` は「ローカル(空)→本番の差分」を migra で取る方式で、このケースだと
> **「No schema changes found」で空振り**した。baseline は次の `db dump` で確実に作る。

### 2-3. baseline を db dump で取得（ベース表問題の解消）
このリポの `supabase/migrations/*.sql` は **monitor 由来の差分のみ**で、ベース表
（tenants/stores/admin_users 等＝reception 由来）を含まない。→ **本番の現行スキーマ全体を
1本の baseline** に取り込む。`YYYYMMDD_NNN` 命名は同日複数で版が衝突するため、個別登録では
なく baseline 方式を採る:

```bash
# 46ファイルを退避（baseline に内包されるため）
mkdir -p supabase/migrations_archive
git mv supabase/migrations/2026*.sql supabase/migrations_archive/

# 本番スキーマを直接 pg_dump（Docker影DB不要・auth/storage等の管理スキーマは自動除外）
supabase db dump --linked -f supabase/migrations/<14桁ts>_remote_baseline.sql
```

> 退避ファイルは履歴として保存（`migrations_archive/README.md` 参照）。`db reset`/`db push`
> では再生しない（baseline に内包）。authz は `tests/authz/schema.sql` を独立管理。

### 2-4. baseline を「適用済み」に登録
本番にはすでに全部適用済みなので、baseline を **再実行させない**:
```bash
supabase migration repair --status applied <14桁ts>   # baseline の版を applied 登録
supabase migration list                               # Local と Remote が一致することを確認
```

以降、本番への変更は **`bun run db:push`** だけで完結（SQL Editor 手貼り卒業）。

---

## 3. 【一度きり】ローカル開発を立ち上げる

```bash
cd claude/monitor
# OrbStack を起動しておく
bun run db:start          # 初回はイメージ取得で数分
bun run db:reset          # baseline + seed をローカルへ適用
bun run db:status         # API URL / anon key / service_role key を確認

cp .env.local.example .env.local
#  .env.local に db:status の値(URL/anon/service_role)を貼る
bun run dev               # http://127.0.0.1:3100
```

### seed（ローカル用テストデータ）
`supabase/seed.sql`（gitignore 済）に**ローカル専用**の最小データを置くと `db reset` 時に投入される。
本番 schema 確定後に、開発用 super_admin（auth.users + admin_users）+ サンプル tenant/store を作る。
> ⚠ seed はローカル専用。本番認証情報・実データは置かない。

---

## 4. 日々の migration フロー（移行後）

1. `bun run db:new add_xxx` で空ファイル作成、または `bun run db:diff -- -f add_xxx` でローカル変更から生成。
2. `bun run db:reset` でローカルに適用して動作確認。
3. RLS を変えた場合は **`tests/authz/schema.sql` も更新**（契約テストの忠実性）＋ `bun run test:authz`。
4. PR → CI 緑 → `monitor-prod` マージ（Vercel デプロイ）。
5. **本番へ migration 適用**: `bun run db:push`（または CI/CD に組込む。当面は手動 push でよい）。

> 将来: `db push` を GitHub Actions に組込めば完全自動化できる（要 `SUPABASE_ACCESS_TOKEN` +
> `SUPABASE_DB_PASSWORD` を repo secret に。今は手動運用で十分）。

---

## 5. よくある落とし穴
- **OrbStack 未起動で `db:start` が失敗** → 先に OrbStack を起動。
- **`major_version` 不一致** → `db pull/push` が警告/失敗。本番の `SHOW server_version;` に合わせる。
- **`db reset` がベース表で失敗** → baseline(§2-2) を取り込めていない。`db pull` をやり直す。
- **本番 keys をローカルに混入** → `.env.local` には必ず `db:status` のローカル値のみ。本番は Vercel env。
