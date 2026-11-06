# 監査の記録の外部保全（ASVS 5.0 L2 16.4.3）

作成: 2026-11-06

アプリ（Vercel）や DB の強い鍵（service_role）を奪われても、証跡を消されたり書き換えられたりしないよう、
監査の記録を **毎日、別の置き場（Cloudflare R2 の専用バケット・Bucket lock）へ書き出します**。

## 1. 何を・いつ

| 表 | 中身 | 日付を決める列 |
|---|---|---|
| `admin_audit_log` | 管理操作 | `ts` |
| `live_sessions` | ライブ・分割・録画の視聴 | `started_at` |
| `video_sessions` | 遠隔視聴 | `created_at` |
| `footage_access_log` | 証跡の静止画・BCP の書き出しなどの閲覧 | `accessed_at` |

- cron `/api/cron/audit-archive`（毎日 UTC 04:00 = 日本 13:00・`vercel.json`）。中身は `src/lib/audit/archive.ts`
- **前の日まで**を書き出す（今日の分は翌日）。直近 7 日で書き出していない日を古い順に拾う（cron が止まっても次の日に追いつく）
- 行は書き出した時点の内容。日をまたいで終わった視聴は、終わりの時刻が空のことがあります（DB 側は 1 年・180 日残ります）

## 2. 置き場の形

```
audit/v1/YYYY/MM/DD/<表>.jsonl.gz   1 行 1 件の JSON を gzip
audit/v1/YYYY/MM/DD/manifest.json   各ファイルの件数・バイト数・SHA-256 と、前の日の manifest の SHA-256
```

- manifest は各日の最後に書きます。manifest がある日 = 書き出し済み
- **前の日の manifest の SHA-256 で日をつなぐ**ので、途中の日を差し替えると、後ろの日の manifest と合わなくなります
- 書くときは `If-None-Match: *` を付け、既にある物を上書きしません
- 失敗した日があれば、その日で止めて 500 を返します（Vercel の Cron の記録で見えます）。後ろの日は次の実行に回します
- 書き出し先が未設定のときは 503 を返します（外へ出せていないことを記録に残すため）

## 3. 置き場の作り方（運営・1 回だけ）

**映像の R2 キー（`R2_ACCESS_KEY_ID`）は使わない。** あちらは消せる権限を持つため、専用のバケットと専用のキーにします。

1. Cloudflare → R2 → バケットを作る: `gvms-audit-archive`（場所は APAC か自動）
2. そのバケット → Settings → **Bucket lock rules** → 追加: 前方一致 `audit/`・**保持 1,825 日（5 年）**。
   期限までは、キーを持っていても消せず上書きもできません（管理画面からも消せません）
3. R2 → Manage API tokens → **Create API token**: 権限 *Object Read & Write*・**対象はこのバケットだけ**。
   表示された Access Key ID と Secret Access Key をコピー（値はチャット・文書に書かない）
4. Vercel → 環境変数（Production）:
   - `AUDIT_ARCHIVE_BUCKET` = `gvms-audit-archive`
   - `AUDIT_ARCHIVE_ACCESS_KEY_ID` / `AUDIT_ARCHIVE_SECRET_ACCESS_KEY` = 3 の値
   - `AUDIT_ARCHIVE_ACCOUNT_ID`（R2 のアカウントが映像と同じなら省略可。`R2_ACCOUNT_ID` を使う）
5. 配り直したあと、過去の分をさかのぼって書き出す（認証は Cron と同じ `CRON_SECRET`）:
   `GET /api/cron/audit-archive?backfill_days=150`（上限 400 日。240 秒で区切り、残りは同じ呼び出しをもう一度）

保持 5 年は `admin_audit_log` の保持（`docs/data-classification.md`）に合わせています。視聴の記録は DB では 1 年・180 日で消えますが、
外部の写しは 5 年残ります（証跡の写しとして扱う。個人の情報は利用者の ID と拠点・カメラの ID で、氏名は遠隔視聴の `viewer_name` だけ）。

## 4. 確かめ方

- 毎日: Vercel の Cron の記録で `/api/cron/audit-archive` が 200（ログの `[audit-archive]` に日ごとの件数）
- 改ざんの検査: 各日の manifest の `files[].sha256` とファイルの SHA-256、`prev_manifest_sha256` と前の日の manifest の SHA-256 が合うこと
- 置き場の権限: 専用キーで既存の物への PUT・DELETE が断られること（Bucket lock）
