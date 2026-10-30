# ログの一覧（G・VMS-Cloud）

作成: 2026-10-31（`monitor-prod` の 89a9218ab のコードから確かめました） / 対象: Vercel・Supabase・`claude/edge-agent`・`claude/cloudflare/*`
自主診断（ASVS 5.0 L2）の **16.1.1**（層ごとのログの一覧）と **16.2.3**（一覧に書いた先だけへログを置く）の文書です。

パスは断りが無ければ `claude/monitor/` からの相対です。保持の期間の正本は [data-classification.md](data-classification.md) §3 と `docs/data-governance-sla.md`（リポジトリの直下）§2 です。ログに何を出してよいかの決まりも [data-classification.md](data-classification.md) §2 にあります。

**プロバイダの画面で設定する保持の期間はコードからは分からないので「要確認」と書いています。**

---

## 1. 全体の表

| # | 層 | 何のログ | 形式 | 置き場所 | 見られる人 | 保持 |
|---|---|---|---|---|---|---|
| L1 | Vercel | 関数のログ（`console.*`） | 文字列（`[タグ] …`） | Vercel のランタイムログ | Vercel のチームの人（運営） | 要確認（プランによる） |
| L2 | Vercel | 安全の出来事 `[security]` | 1 行の JSON | L1 と同じ | 同上 | **決定は 90 日・未実装**（L1 のまま） |
| L3 | Supabase DB | 管理操作 `admin_audit_log` | 表（RLS） | DB | §2.3 | **5 年** |
| L4 | Supabase DB | 映像の閲覧 `live_sessions` | 表 | DB（月ごとのパーティション） | §2.4 | **1 年** |
| L5 | Supabase DB | 遠隔視聴 `video_sessions` | 表 | DB | §2.4 | **180 日** |
| L6 | Supabase DB | 証跡の静止画の閲覧 `footage_access_log` | 表（5 分に 1 行） | DB | §2.4 | **180 日** |
| L7 | Supabase DB | 回数の制限 `rate_limits` | 表 | DB | サーバだけ | **1 日** |
| L8 | Supabase DB | 稼働の数字 `metric_events` | 表 | DB | §2.6 | **90 日** |
| L9 | Supabase DB | 運用の点検 `ops_check_runs` | 表 | DB | §2.6 | **90 日** |
| L10 | Supabase | Auth のログ | プロバイダの形式 | Supabase | Supabase のプロジェクトの人（運営） | 要確認（プランによる） |
| L11 | Supabase | Edge Function `jalert-poller` のログ | 文字列 | Supabase | 同上 | 要確認（プランによる） |
| L12 | エッジ | edge-agent のログ | 1 行の JSON（pino） | 機械の journald | 機械の管理者 | 要確認（OS の設定による） |
| L13 | Cloudflare | Worker `intereco-edge-images`・`intereco-live-gate` | コードからは書かない | 残さない（`wrangler tail` で流れを見るだけ） | Cloudflare のアカウントの人 | 残さない |
| L14 | GitHub | バックアップの実行の記録 | Actions のログ | GitHub | リポジトリの権限の人 | 要確認 |

**ログの外部への転送はしていません。** Vercel のログの外部への転送（Log Drain）は**発注者の判断待ち**です。`[security]` の 90 日は、転送先を決めてから実現します（[data-classification.md](data-classification.md) §4 の D7）。

## 2. 層ごとの中身

### 2.1 Vercel の関数のログ（L1）

- **何を**: API と cron の失敗と注目の出来事。`console.*` は `src/app/api` と `src/lib` の本番のコードに 110 か所あります。タグの例: `[api]`（DB の失敗・`src/lib/api/db-error.ts`）・`[audit]`・`[email]`・`[rate-limit]`・`[heavy-limit]`・`[vod/cleanup]`・`[data-retention]`・`[edge-health]`・`[video/dispatch]`。
- **形式**: 自由な文字列（タグと文）。決まった形は `[security]` だけです。
- **使い方**: 障害の調査。`CRON_SECRET` の定期の処理の結果の確認。
- **出さないもの**: パスワード・トークン・署名付きの URL（`NVMS/docs/GVMS_CLOUD_SPEC.md` の大原則・`src/app/api/edge/video/upload-urls/route.ts` のコメント）。DB の誤りの文（`dbErrorCode`）はログにだけ出し、応答には出しません。自動で伏せ字にする仕組みはなく、書く側の決まりです。
- **根拠**: `src/lib/api/db-error.ts`・各 `route.ts`。

### 2.2 安全の出来事 `[security]`（L2）

- **形式**: `console.warn` の 1 行。`[security] {"ts":"…","kind":"…","actor":"…","ip":"…","path":"…","status":…,"detail":{…}}`（`src/lib/security/events.ts`）。
- **載せないもの**: パスワード・PIN・トークン・メールアドレス。利用者は UUID。回数の制限の鍵は種類だけ。入力の検査の失敗は中身を書かない（`src/lib/api/invalid-input.ts`）。
- **間引き**: `input.invalid` は同じ種類・道・接続元を 60 秒に 1 行へ（捨てた数は `detail.suppressed`）。関数のインスタンスごとに数えます。
- **種類**:

| kind | いつ | 書く所 |
|---|---|---|
| `authz.denied` | 役割・範囲の外（401/403） | `src/lib/admin/guard.ts` ほか |
| `auth.mfa_required`・`auth.foreign_token`・`auth.tenant_suspended`・`auth.password_change_required`・`auth.boundary`・`auth.cross_site` | 門で止めた | `src/middleware.ts`（`auth.cross_site` は `src/lib/auth/server-auth.ts` からも） |
| `auth.initial_password_expired`・`auth.login_failed` | ログイン | `src/app/api/auth/login/route.ts` |
| `auth.mfa_failed` | 多要素の番号の誤り | `src/app/api/auth/mfa/route.ts`・`src/app/api/account/mfa/verify/route.ts` |
| `auth.recovery_failed` | 再設定の番号の誤り | `src/app/api/auth/recovery/verify/route.ts` |
| `edge.auth_failed` | エッジのトークンの誤り | `src/lib/edge/device-auth.ts` |
| `kiosk.pin_failed`・`kiosk.pin_locked`・`kiosk.pin_ok` | キオスクの PIN | `src/app/api/baggage/kiosk/pin-login/route.ts` |
| `rate_limited` | 回数の制限を超えた | `src/lib/rate-limit.ts` |
| `input.invalid` | zod に通らなかった 400 | `src/lib/api/invalid-input.ts` |

- **使い方**: 総当たりや越権の試しに気づく。今は通知の条件にはしておらず、Vercel のログの検索で見ます。
- **残**: `edge.auth_failed` を書くのは `src/lib/edge/device-auth.ts` の `authenticateEdge` だけです。`hashDeviceToken` を直接使う受け口（`/api/alarms/ingest`・`/api/alarms/frames/ingest`・`/api/security/patrol/ingest`・`/api/baggage/edge/clip-upload`・`/api/edges/[id]/image-upload-url`）のトークンの失敗は記録されません（要件 16.3.2・16.3.3。§4 の残）。

### 2.3 管理操作 `admin_audit_log`（L3）

- **何を**: 管理の変更（`recorder.*`・`edge.*`・`store.*`・`user.*`・`tenant.*`・`enrollment.*`・`license.revoke`・`secrets.rewrap`・`session.revoke_*`・`sso_grant.revoke`・`retention.employee.purge`・`store.onvif_webhook_token.read` など）。`recordAudit` の呼び出しは 42 ファイルにあります。
- **列**: `ts`・`actor_user_id`・`action`・`target_type`・`target_id`・`store_id`・`changes`（JSON・秘密はマスクする決まり）。
- **書くのは**: サーバの接続だけ（`src/lib/admin/audit.ts`・利用者の INSERT の決まりは 20261029120000 で外した）。**記録の失敗で本処理は止めません**（`[audit]` の warn だけ）。
- **見られる人**: RLS `admin_audit_log_select`（super_admin は全件・`tenant_admin` は自テナントの店舗・`store_manager` は自店舗。`store_id` が空の行は super_admin だけ）。画面は `/admin/audit/changes`・`/admin/ops-audit`。**運営の操作はテナントの画面に出しません**（`/admin/ops-audit` に出す）。
- **保持**: 5 年。`/api/cron/data-retention`（`src/lib/retention/data-retention.ts`）。

### 2.4 視聴の記録（L4・L5・L6）

| 表 | 何を | 主な列 | 見られる人 | 消し方 |
|---|---|---|---|---|
| `live_sessions` | ライブ・分割・録画の視聴（`/api/sessions`・`start_live_session`） | `user_id`・`store_id`・`camera_id`・`mode`・`started_at`・`ended_at`・`duration_sec` | 本人・super_admin・`tenant_admin`（自テナント）・`store_manager`（自店舗）。画面は `/admin/audit`・`/admin/ops-audit`。利用者の書き換えはトリガで絞る（`20261029150000_live_sessions_integrity.sql`） | `started_at` から 1 年・`/api/cron/data-retention` |
| `video_sessions` | 遠隔視聴（`/api/video/sessions`） | `edge_id`・`camera_id`・`store_id`・`user_id`・`viewer_name`・`kind`・`state`・`vod_from`・`vod_to`・`error` | 本人・super_admin | 作ってから 180 日で、置き場を消し終えた行・`/api/cron/data-retention` |
| `footage_access_log` | 証跡の静止画・BCP の書き出し・手荷物検査の表示（`src/lib/audit/footage-access.ts`。best-effort） | `actor_user_id`・`access_type`・`resource_id`・`store_id`・`bucket`・`accessed_at` | super_admin・`tenant_admin`（自テナント）。画面は `/admin/audit`・`/admin/ops-audit` | 180 日・`/api/admin/vod/cleanup` |

運営（super_admin）の視聴はテナントの画面に出さず、`/admin/ops-audit` に出します（`src/app/admin/audit/page.tsx`）。

### 2.5 回数の制限（L7）

`rate_limits` は `rate_limit_hit` の数え場所で、鍵にメールアドレスと IP が入ります。読み書きは関数経由だけです（`src/lib/ops/schema-invariants.ts`）。1 日で消します（`/api/admin/vod/cleanup`）。

### 2.6 稼働と点検（L8・L9）

| 表 | 何を | 見られる人 | 消し方 |
|---|---|---|---|
| `metric_events` | エッジの稼働・初フレームの遅延など（`src/lib/metrics.ts`・`/api/metrics`。書くのはサーバの接続だけ） | super_admin・`tenant_admin`（自テナント）・`store_manager`（自店舗）（RLS `metric_events_select`） | 90 日・`/api/cron/edge-health` |
| `ops_check_runs` | 日次の点検の結果（`src/app/api/cron/partition-health/route.ts`） | super_admin だけ（RLS `ops_check_runs_select`） | 90 日・`supabase/migrations/20260812060000_ops_check_runs.sql` |

### 2.7 Supabase の Auth と Edge Function（L10・L11）

- **Auth**: ログイン・トークンの発行などを Supabase が記録します。こちらのコードでは書きません。形式と保持はプランによります（要確認）。アプリ側の失敗の記録は L2 の `auth.*` です。
- **`jalert-poller`**: `console.*` が 42 か所（`supabase/functions/jalert-poller/index.ts`）。フィードの取得の失敗・発令の流れを文字列で書きます。Supabase の Edge Function のログに残ります（保持は要確認）。

### 2.8 エッジ（L12）

- **形式**: `pino` の JSON を標準出力へ（端末のときだけ見やすい形）。既定の水準は `info`（`LOG_LEVEL`）。`claude/edge-agent/src/logger.ts`。
- **置き場所**: systemd の journald（`claude/edge-agent/systemd/edge-agent.service` はログの指定なし＝既定）。`journalctl -u intereco-edge` で見ます（`claude/edge-agent/README.md`）。
- **転送**: していません。README の「未実装」に journald から外部への転送があります。
- **伏せ字**: `logger.ts` に `redact` の設定はなく、書く側の決まりです。
- **見られる人・保持**: 機械の管理者・OS の journald の設定（要確認）。
- G・VMS（nvmsd）のログは G・VMS 側の文書の範囲です。クラウドに届くのは管理者が頼んだ診断の束だけで、`diagnostics` に 30 日置く決まりです（[data-classification.md](data-classification.md) §3.3。今は次の束を頼んだときにだけ消します）。

### 2.9 Worker（L13）

2 本の Worker（`claude/cloudflare/edge-images/src/index.js`・`claude/cloudflare/live-gate/src/index.js`）のコードに `console.*` は無く、`wrangler.toml` に `observability`・`logpush` の設定もありません。断った理由は応答で返すだけで、調べるときは `wrangler tail` で流れを見ます（`claude/cloudflare/edge-images/README.md`）。Cloudflare の画面の分析の保持は要確認です。

### 2.10 バックアップの実行（L14）

既定の枝 `design/v2-redesign` の `.github/workflows/db-backup.yml`（毎時）。失敗は `ALERT_EMAILS` へ Resend で知らせます（`docs/dr-runbook.md`）。Actions のログの保持はリポジトリの設定によります（要確認）。

## 3. 一覧に書いた先だけへ置く決まり（16.2.3）

- ログを置いてよいのは §1 の表の先だけです。Sentry・Datadog などの外部の転送の部品は `claude/monitor/package.json` にありません。`src/instrumentation.ts` もありません（2026-10-31 に確かめました）。
- 通知（`ALERT_EMAILS`・`ALERT_WEBHOOK_URL`・`FEEDBACK_EMAILS`）はログそのものではなく、運用の知らせです。[communications.md](communications.md) §1.3 にあります。
- 新しいログの先（Log Drain を含む）を足すときは、**先にこの表へ行を足し**、[data-classification.md](data-classification.md) の「外への委託」も直します。
- 確かめ方: 四半期の態勢監査（`docs/security-assessment.md`）で、`console.` のタグと `package.json` の依存を見ます。

## 4. 要確認と残の一覧

残: §2.2 の `edge.auth_failed` の抜け（コードの直しが要る）。以下は確かめる先がコードの外のものです。

| # | 中身 | 確かめる先 |
|---|---|---|
| Q-1 | Vercel のランタイムログの保持の日数とチームの権限 | Vercel の画面 |
| Q-2 | Supabase の Auth・Edge Function のログの保持の日数 | Supabase の画面 |
| Q-3 | エッジの journald の保持 | 機械の設定 |
| Q-4 | Cloudflare の Worker の分析の保持 | Cloudflare の画面 |
| Q-5 | GitHub Actions のログの保持 | リポジトリの設定 |
| Q-6 | **Vercel のログの外部への転送**（発注者の判断待ち）。決めたら `[security]` の 90 日をそこで実現する | 発注者 |

## 5. 見直し

ログの種類・`[security]` の kind・置き場所を足すときに、この文書を同じ PR で直します。保持の期間を変えるときは [data-classification.md](data-classification.md) の決まりに従います。
