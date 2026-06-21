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

### 2-2. baseline 取得（ベース表問題の解消）
このリポの `supabase/migrations/*.sql` は **monitor 由来の差分のみ**で、ベース表
（tenants/stores/admin_users 等＝reception 由来）を含まない。そのままでは `db reset` が
ローカルで失敗する。→ **本番の現行スキーマ全体を baseline として取り込む**:

```bash
supabase db pull                 # → supabase/migrations/<ts>_remote_schema.sql (本番の全スキーマ)
```

この baseline には既存の日付付き migration の結果も**畳み込まれている**ため、既存ファイルと
二重になる。次のように整理する:

```bash
mkdir -p supabase/migrations_archive
git mv supabase/migrations/2026*.sql supabase/migrations_archive/   # baseline 以前の履歴を退避
# ↑ remote_schema(baseline) だけ migrations/ に残す
```

> 退避したファイルは履歴として保存（authz schema.sql 同期の参照元）。`db reset` では
> 再生しない（baseline に含まれるため）。

### 2-3. 本番の migration 履歴を「適用済み」に整える
本番にはすでに全部適用済みなので、baseline を **再実行させない**:

```bash
supabase migration list                          # local と remote の差分を確認
supabase migration repair --status applied <baseline-ts>  # baseline を適用済みとして記録
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
