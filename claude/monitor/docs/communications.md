# 外との通信の一覧（G・VMS-Cloud）

作成: 2026-10-31（`monitor-prod` の 89a9218ab のコードから確かめました） / 対象: `claude/monitor`・`claude/edge-agent`・`claude/cloudflare/*`・Supabase Edge Function `jalert-poller`
自主診断（ASVS 5.0 L2）の **13.1.1**（頼っている外部サービスと、利用者が外への宛先を指定できる箇所の文書化）と **13.2.5**（サーバが送る先の許可リスト）の文書です。

パスは断りが無ければ `claude/monitor/` からの相対です。**環境変数は名前だけを書きます。値はここに書きません。** 鍵の方式・共有先・作り直しは [security-keys.md](security-keys.md)、預けるデータの区分は [data-classification.md](data-classification.md) にあります。G・VMS（nvmsd）とクラウドの間の受け口は `NVMS/docs/GVMS_CLOUD_SPEC.md` が正本です。

---

## 1. 外部サービスの一覧（13.1.1）

### 1.1 基盤

| サービス | 用途 | 送るデータ | 認証 | 環境変数（名前だけ） | 根拠 |
|---|---|---|---|---|---|
| Supabase（DB・Auth・Storage・Edge Functions） | 全データ・ログイン・ファイルの置き場・J アラートの取得 | 全テナントのデータ。区分は [data-classification.md](data-classification.md) | anon key と利用者の JWT（RLS）・service_role key（サーバだけ）・エッジは短命のトークンかデバイストークン | `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY` | `src/lib/supabase/server.ts`・`.env.example` |
| Vercel | 画面と API の実行（`hnd1`）・cron | 要求とレスポンス・関数のログ（[logging-inventory.md](logging-inventory.md)） | cron は `CRON_SECRET` の Bearer | `CRON_SECRET`・`VERCEL_GIT_COMMIT_SHA`（Vercel が入れる） | `vercel.json` |
| GitHub Actions | DB の毎時のバックアップ（`pg_dump`）を暗号化して R2 へ | `public` と `auth` のデータ（パスワードのハッシュを含む・GPG で暗号化） | リポジトリの Secrets | `BACKUP_DATABASE_URL`・`BACKUP_ENC_PASSPHRASE`・`R2_ACCOUNT_ID`・`R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY`・`R2_BACKUP_BUCKET`・`RESEND_API_KEY` | 既定の枝 `design/v2-redesign` の `.github/workflows/db-backup.yml`・`docs/dr-runbook.md` |

### 1.2 Cloudflare

| サービス | 用途 | 送るデータ | 認証 | 環境変数（名前だけ） | 根拠 |
|---|---|---|---|---|---|
| R2（S3 API） | ライブ画像・遠隔視聴の HLS・手荷物検査のクリップの置き場 | 映像（段階 B） | S3 の鍵・署名付きの URL | `R2_ACCOUNT_ID`・`R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY`・`R2_EDGE_BUCKET`・`R2_VIDEO_BUCKET`・`R2_BAGGAGE_BUCKET` | `src/lib/storage/edge-images-r2.ts`・`src/lib/storage/video-r2.ts`・`src/lib/baggage/r2.ts` |
| Worker `intereco-edge-images`（`img.genesis-edge.com`） | R2 への読み書きの口 | 映像 | HMAC の署名 | `EDGE_IMAGES_BASE_URL`・`EDGE_IMAGES_SIGNING_SECRET` | `claude/cloudflare/edge-images/`・`src/lib/storage/edge-images-sign.ts` |
| Worker `intereco-live-gate` | 店舗のトンネルのライブ `/api/*` の門 | 映像 | HMAC の署名・サービストークン | `LIVE_SIGNING_SECRET`・`LIVE_SIGN_TTL_SEC` | `claude/cloudflare/live-gate/`・`src/lib/live-sign.ts` |
| Access（サービストークン）・Tunnel | 店舗の go2rtc・Frigate への中継 | ライブと録画の HLS | `CF-Access-Client-Id`・`CF-Access-Client-Secret` のヘッダ（§3 の宛先だけに付ける） | `GO2RTC_CF_ACCESS_CLIENT_ID`・`GO2RTC_CF_ACCESS_CLIENT_SECRET`・`UPSTREAM_ALLOWED_HOST_SUFFIXES` | `src/lib/proxy/upstream.ts`・`src/app/api/live-proxy/[cameraId]/[...path]/route.ts`・`src/app/api/vod-hls/[cameraId]/[...path]/route.ts` |
| DNS API（`api.cloudflare.com`） | 拠点の https の名前の A レコードと、証明書の検証の TXT | 拠点のラベルと LAN の IP | API トークン（拠点には渡さない） | `CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ZONE_ID`・`GVMS_SITE_DOMAIN` | `src/lib/dns/cloudflare.ts`・仕様書 §10 |

### 1.3 通知

| サービス | 用途 | 送るデータ | 認証 | 環境変数（名前だけ） | 根拠 |
|---|---|---|---|---|---|
| Resend（`api.resend.com`） | メール（パスワードの再設定・発報・BCP・運用の通知・要望の知らせ） | 宛先のメールアドレス・本文（店舗の名前など）・BCP の PDF の添付 | API キー | `RESEND_API_KEY`・`ALERT_EMAILS`・`FEEDBACK_EMAILS` | `src/lib/email/send.ts`・`src/lib/ops/notify-channel.ts`・`supabase/functions/jalert-poller/index.ts` |
| 運用の Webhook | 運用の通知の複線（Slack・Discord など） | 通知の文（エッジの死活など） | URL そのもの | `ALERT_WEBHOOK_URL` | `src/lib/ops/webhook.ts` |

### 1.4 認識と地図・公的情報

| サービス | 用途 | 送るデータ | 認証 | 環境変数（名前だけ） | 根拠 |
|---|---|---|---|---|---|
| AWS Rekognition | 手荷物検査の顔の登録と照合（サーバだけ） | **顔写真（段階 A）**・外部 ID | IAM の鍵 | `AWS_REGION`・`AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY` | `src/lib/aws/rekognition.ts`・[data-classification.md](data-classification.md) §4 の D9・D10 |
| 気象庁の XML フィード（`www.data.jma.go.jp`） | J アラート相当の取得（地震・特別警報） | 送らない（取得だけ） | なし | なし（URL はコードに固定） | `supabase/functions/jalert-poller/index.ts` |
| Nominatim（`nominatim.openstreetmap.org`） | 住所から座標を引く（サーバから） | 店舗の住所か郵便番号 | なし（1 秒 1 回の約款を守る） | なし | `src/app/api/geocode/route.ts`・`src/app/api/admin/geocode/route.ts` |
| zipcloud（`zipcloud.ibsnet.co.jp`） | 郵便番号から住所を引く（サーバから） | 郵便番号 | なし | なし | `src/app/api/geocode/route.ts` |
| OpenStreetMap のタイル（`*.tile.openstreetmap.org`） | 地図の表示（**閲覧者のブラウザから**） | 閲覧者の IP・見ている地図の範囲 | なし | なし | `src/app/map/store-map.tsx`・`next.config.ts` |
| jsDelivr（`cdn.jsdelivr.net`） | BCP の報告書の PDF の日本語の字形（サーバから） | 送らない（取得だけ） | なし | なし | `src/lib/pdf/bcp-report.tsx`（§4 の残） |

### 1.5 使わない方向のもの

| サービス | 状態 |
|---|---|
| LiveKit Cloud（SFU） | **使いません（2026-10-31 発注者の判断）。本番の環境変数を削除して止めました（`/api/livekit/token` が 404 を返すことを確認）。** コードは `LIVEKIT_ENABLED='true'` と `LIVEKIT_URL`・`LIVEKIT_API_KEY`・`LIVEKIT_API_SECRET` が揃うときだけ動き、それ以外では `/api/livekit/*` は使えず、`/api/cron/sfu-reaper` は何もしません（`src/lib/livekit.ts`・`src/app/api/cron/sfu-reaper/route.ts`）。G・VMS の拠点の SFU（`GVMS_SFU_ENABLED`）は 2026-09-29 から保留で既定 OFF です。本番の環境変数の削除が済んだかは要確認です |

### 1.6 Supabase から出る通信

| 通信 | 用途 | 根拠 |
|---|---|---|
| Supabase（`pg_net`）→ Vercel `/api/bcp-webhook` | BCP の報告書の作成の起動（`BCP_WEBHOOK_SECRET` の Bearer・Vault に保管） | `supabase/migrations/20260707090000_remote_baseline.sql`・[security-keys.md](security-keys.md) |
| Supabase（`pg_net`）→ Edge Function `jalert-poller` | 毎分の起動 | 同上 |
| Edge Function → 気象庁・Resend・Supabase | §1.4・§1.3 | `supabase/functions/jalert-poller/index.ts`。依存は `deno.land`・`esm.sh` から読む |

### 1.7 エッジと拠点から出る通信

| 送り元 → 宛先 | 用途 | 認証 | 根拠 |
|---|---|---|---|
| G・VMS（nvmsd）→ クラウド | 接続仕様 v1 の受け口すべて | Bearer トークン | `NVMS/docs/GVMS_CLOUD_SPEC.md` §3・§4 |
| エッジ（edge-agent）→ Supabase | DB・Storage（`EDGE_SCOPED_DB` のときは短命のトークン） | `SUPABASE_URL`・`SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY`（省ける） | `claude/edge-agent/src/config.ts`・`.env.example` |
| エッジ → クラウド | bootstrap など（`MONITOR_URL`）・デバイストークン | `EDGE_DEVICE_TOKEN` | 同上 |
| エッジ → R2・Worker | 署名付きの URL で置く | 署名 | `claude/edge-agent/src/upload/` |
| エッジ → 店舗の LAN のカメラ・録画機 | RTSP・ONVIF・各社の API（§2 の宛先） | 機器の資格情報（暗号化して DB に置く） | `claude/edge-agent/src/adapters/` |
| エッジ → LiveKit | `LIVEKIT_URL`（任意）。§1.5 のとおり使わない | — | `claude/edge-agent/src/config.ts` |
| 拠点 → クラウドの中継（入り） | Cloudflare Tunnel（クラウドから拠点へ入るのはこれだけ） | §1.2 | `src/lib/proxy/upstream.ts` |

## 2. 利用者が外への宛先を指定できる箇所（13.1.1）

「誰が繋ぐか」がサーバのものは SSRF と鍵の漏れの対象です。ブラウザとエッジが繋ぐものは、その立場で見ます。

| 値 | 決める人 | 誰が繋ぐか | 保存のときの検査 | 使うときの守り | 根拠 |
|---|---|---|---|---|---|
| `alarm_settings.notify_webhook_url` | 店舗の担当（RLS） | **Vercel のサーバ** | `webhookUrlProblem` | もう一度 `webhookUrlProblem`。転送を追わない。5 秒 | `src/lib/alarms/webhook-url.ts`・`src/app/alarms/actions.ts`・`src/lib/alarms/notify.ts` |
| `recorder_cameras.hls_url` | 管理者 | **Vercel のサーバ** | `isUpstreamAddress`（http(s)） | `allowedUpstreamOrigin`。経路は `safeSubPath`。型は `safeContentType`。転送を追わない。30 秒 | `src/app/api/admin/recorders/[id]/cameras/route.ts`・`src/app/api/live-proxy/[cameraId]/[...path]/route.ts` |
| `edge_devices.go2rtc_host` | 運営（super_admin） | **Vercel のサーバ** | **形を見ない**（空を NULL にするだけ） | 中継は `allowedUpstreamOrigin`。死活の確認（`/api/cron/edge-health`）は**許可の外にも鍵なしで送る**（§4 の残） | `src/app/api/admin/edges/[id]/route.ts`・`src/app/api/cron/edge-health/route.ts` |
| `recorders.live_host` | 管理者 | **Vercel のサーバ**（録画の中継）と**閲覧者のブラウザ**（Frigate の iframe） | `isUpstreamAddress`（ホストだけも可） | サーバは `allowedUpstreamOrigin`。ブラウザへは CSP の `frame-src` を掛けていない | `src/app/api/admin/recorders/[id]/route.ts`・`src/app/api/vod-hls/[cameraId]/[...path]/route.ts`・`src/app/stores/[id]/cam/[cameraId]/live/page.tsx`・`src/lib/security/csp.ts` |
| `recorders.vod_host` | 管理者 | エッジ | `isUpstreamAddress`（ホストだけも可） | エッジが店舗の LAN から繋ぐ。クラウドは繋がない | `src/app/api/admin/recorders/[id]/route.ts`・`claude/edge-agent/src/modes/vod.ts` |
| `stores.nvr_endpoint` | 管理者 | エッジ（中央モード） | `new URL` で読めることだけ | クラウドの接続試験はモック（繋がない） | `src/app/admin/stores/[id]/nvr/actions.ts`・`src/app/api/admin/stores/[id]/nvr/test-connection/route.ts`・`claude/edge-agent/src/modes/central/tenant-pool.ts` |
| `recorders.host`・`recorder_cameras.live_rtsp` | 管理者 | エッジ | 空でないことだけ（`host`）・形を見ない（`live_rtsp`） | エッジが店舗の LAN から繋ぐ | `src/app/api/admin/recorders/route.ts`・`cameras/route.ts`・`claude/edge-agent/src/cameras.ts` |
| `oidc_redirect_uris` | 拠点（heartbeat の申告） | 閲覧者のブラウザ（サインインの戻り先） | `allowedRedirectHost`。Supabase の OAuth のクライアントに完全一致で登録 | 同左 | `src/lib/edge/gvms-oidc.ts`・`src/app/api/edge/heartbeat/route.ts`・仕様書 §9.2 |
| `bcp_clips.clip_url`（古い行） | エッジの鍵で書ける | **Vercel のサーバ**（ZIP） | — | `isOwnStorageUrl`（この Supabase の保存先だけ） | `src/lib/storage/own-storage-url.ts`・`src/app/api/bcp/[id]/snapshots.zip/route.ts` |
| 拠点の https のラベルと LAN の IP | 運営 | DNS（Cloudflare へ書く） | `normalizeLabel`・`isPrivateIPv4` | 自分のゾーンの中だけ | `src/app/api/admin/edges/[id]/site-host/route.ts`・`src/lib/edge/site-tls.ts` |
| 通知のメールアドレス（発報・手荷物検査・BCP） | 店舗の担当・管理者 | Resend | メールの形（手荷物検査は 10 件まで） | 送り元は固定のドメイン | `src/app/api/baggage/settings/route.ts`・`src/lib/email/send.ts` |

サーバが繋がないもの（参考）: 要望の `page_url`（場所だけ残す）・要望の話題の `issue_url`（https の形を見て、画面のリンクにするだけ・`src/lib/feedback/topic-schema.ts`）。

外から来る宛先: `jalert-poller` は気象庁のフィードの `<link>` の URL から本文を取ります（`fetchDetail`）。ホストの確認はありません（§4 の残）。

## 3. 送る先の絞り方（13.2.5）

**Vercel の関数の外向きの通信全体を絞る許可リストはありません。** 今は、受け口ごとに次のように絞っています。

| 送る先 | 絞り方 | 根拠 |
|---|---|---|
| 店舗の go2rtc・Frigate（サービストークンを付ける） | **https** で、許した名前の末尾（`UPSTREAM_ALLOWED_HOST_SUFFIXES`・既定 `.genesis-edge.com`）のホストだけ。利用者名とパスワードを含む URL を断る。経路の部品に `.`・`..`・`/`・`\`・`%` を含むものを断る。転送を追わない | `src/lib/proxy/upstream.ts`（`allowedUpstreamOrigin`・`safeSubPath`・`fetchUpstream`） |
| 発報の Webhook | https だけ。IP の直書きの内部の住所と、代表的な内部の名前を断る。転送を追わない。**名前を引いた先が内部かは見分けられない**（コードのコメントのとおり） | `src/lib/alarms/webhook-url.ts` |
| Supabase の古い公開の URL | この Supabase のプロジェクトの保存先だけ | `src/lib/storage/own-storage-url.ts` |
| Resend・Cloudflare の API・Nominatim・zipcloud・気象庁のフィード・jsDelivr | URL をコードに固定（利用者が変えられない） | §1 の根拠 |
| R2・Worker・AWS・Supabase | 環境変数かアカウントの ID で決まる（利用者が変えられない） | §1 の根拠 |
| `ALERT_WEBHOOK_URL`・`EDGE_IMAGES_BASE_URL` | 環境変数（運営だけが決める）。形の検査はない | `src/lib/ops/webhook.ts`・`src/lib/storage/edge-images-sign.ts` |

通信の時間切れの決まりは [security-maintenance.md](security-maintenance.md) §3.1 にあります。画面側の通信は CSP の `default-src`・`connect-src` で絞っていません（`src/lib/security/csp.ts` のコメントのとおり、Supabase・Cloudflare へ繋ぐため）。

## 4. 残（文書を書いて見つけたもの）

| # | 中身 | 要件 |
|---|---|---|
| C-1 | `/api/cron/edge-health` の死活の確認は、`go2rtc_host` が許可の外でも鍵なしで送る（書けるのは運営だけ）。許可の外なら送らない形にできるか検討する | 13.2.4・13.2.5 |
| C-2 | Vercel の外向きの通信全体の許可リストが無い。代わりの手段（固定 IP での絞りなど）は発注者と検討する | 13.2.5 |
| C-3 | 発報の Webhook は、名前を引いた先が内部の住所のものを見分けられない | 13.2.5 |
| C-4 | BCP の報告書の字形を `cdn.jsdelivr.net` の `@main`（版を固定しない）から取っている。巡回と月次の PDF は同梱の `fonts/` を使っている（`src/lib/security/patrol-report.ts`・`src/lib/reports/monthly-pdf.ts`）ので、そろえるか検討する | 13.1.1 |
| C-5 | `jalert-poller` の `fetchDetail` は、フィードの `<link>` のホストを確かめない。気象庁のホストに絞れるか検討する | 13.2.5 |
| C-6 | `go2rtc_host`・`live_rtsp`・`nvr_endpoint` の保存のときの形の検査が弱い（`input-validation.md` §7 の R-4） | 2.2.1 |
| C-8 | Cloudflare Access のサービストークンがどのホストに効くかは、コードからは分からない（要確認） | 13.1.1 |

## 5. 見直し

新しい外部サービス・環境変数・利用者が決める宛先を足すときに、この文書を同じ PR で直します。四半期の態勢監査（`docs/security-assessment.md`）のときに、`process.env` と `fetch(` の使われ方をこの文書と比べます。
