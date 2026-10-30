# 入力の検査と業務の上限（G・VMS-Cloud）

作成: 2026-10-31（`monitor-prod` の 89a9218ab のコードから確かめました） / 対象: `claude/monitor`（画面と API）・`claude/cloudflare/edge-images`（Worker）・Supabase Storage
自主診断（ASVS 5.0 L2）の次の要件の文書です。

| 要件 | 中身 | 節 |
|---|---|---|
| 2.1.1 | 項目の形と長さの決まり | §1・§2 |
| 2.1.2 | 組み合わせの整合の決まり | §3 |
| 2.1.3 | 利用者ごと・全体の業務の上限 | §4 |
| 5.1.1 | 受け取るファイルの種類・大きさと、悪性のファイルの扱い | §5・§6 |

パスは断りが無ければ `claude/monitor/` からの相対です。「残」は文書を書いて見つけた不足で、§7 にまとめています。

関連の文書（ここでは繰り返しません）:

- 回数の制限とロックの考え方・パスワードの決まり: [authentication-policy.md](authentication-policy.md) §2・§3
- 重い処理の守り（関数の時間・DB の時間の上限）: [security-maintenance.md](security-maintenance.md) §3
- データの区分と保持の期間: [data-classification.md](data-classification.md)
- エッジの受け口の項目の正本: `NVMS/docs/GVMS_CLOUD_SPEC.md`（§4・§5・§12）

---

## 1. 検査の決まりの置き場所（2.1.1）

**項目の形と長さの正本は、各受け口の zod の定義です。** この文書は共通の考え方と主な値だけを書きます。値を変えるときはコードを直し、§2 の表に載っている値ならこの文書も同じ PR で直します。

| 道具 | 場所 | 役目 |
|---|---|---|
| zod の定義 | 各 `src/app/api/**/route.ts` の `Body` など・`src/lib/feedback/schema.ts`・`src/lib/feedback/image.ts` | 項目の型・長さ・範囲・列挙 |
| 検査に落ちたときの記録 | `src/lib/api/invalid-input.ts` の `invalidInput` | 400 を返し、`[security]` の `input.invalid` を記録する。入力の中身は書かない。同じ道・同じ接続元は 60 秒に 1 行へ間引く（[logging-inventory.md](logging-inventory.md) §2.2） |
| 共通の検査 | `src/lib/security/input.ts` | 下の表 |
| 上流の宛先の検査 | `src/lib/proxy/upstream.ts`・`src/lib/alarms/webhook-url.ts` | [communications.md](communications.md) §3 |
| 本文の大きさの上限つき読み取り | `src/lib/feedback/intake.ts` の `readJsonBody`・`readBytesLimited` | 読みながら数えて 413 で止める |

`src/lib/security/input.ts` の道具:

| 関数 | 決まり |
|---|---|
| `postgrestSearchTerm` | 検索語から絞り込みの書式の記号を外し、100 字までにする |
| `isSafePathSegment` | Storage の経路の 1 区切り。英数字・`_`・`-` の 1〜64 字 |
| `isKioskPhotoPath` | キオスクの写真の経路が `<storeId>/<YYYYMMDD>/[card-]<uuid>.<jpg\|png\|webp>` の形そのものか |
| `safeZipSegment` | ZIP の中の名前から区切り文字と制御文字を除き、`.` だけの名前を置き換える |
| `decodeImageDataUrl` | data URL の宣言と中身の先頭の印が一致する画像だけを返す |
| `sniffImage` | 中身の先頭の印から形式を決める（宣言を見ない） |
| `isUpstreamAddress` | 上流の住所の形。`http(s)://`（利用者名とパスワードを含まない）か、許すときは `ホスト[:番号]`。300 字まで |

### 受け口の種類ごとの決まり

| 種類 | 認証 | 検査の決まり | 根拠 |
|---|---|---|---|
| エッジの受け口 `/api/edge/*` | デバイストークン | zod。ID は UUID。将来の項目を止めないため、未知の項目と `context`・`page_url`・`attachment` の宣言は**捨てて拒否しない**（仕様書 §2 の決まり） | `src/app/api/edge/feedback/route.ts`・`src/lib/feedback/schema.ts` |
| エッジのファイルの受け口 `/api/alarms/ingest`・`/api/alarms/frames/ingest`・`/api/security/patrol/ingest` | デバイストークン | multipart。発報は zod、残り 2 本は手書きの検査（§7 の R-1） | 各 `route.ts` |
| 管理の API `/api/admin/*` | ログインと役割（`src/lib/admin/guard.ts`） | zod。上流の住所は `isUpstreamAddress` | `src/app/api/admin/recorders/[id]/route.ts` ほか |
| 画面の API `/api/vod`・`/api/video/sessions`・`/api/feedback`・`/api/baggage/*` | ログインと RLS | zod | 各 `route.ts` |
| キオスク `/api/baggage/kiosk/*` | PIN のセッションかログイン（`src/lib/baggage/kiosk-guard.ts`） | zod。写真は `decodeImageDataUrl`、経路は `isKioskPhotoPath` | 各 `route.ts` |
| 認証 `/api/auth/*` | なし（入口） | 手書きの検査と回数の制限。ログインはメール 320 字・パスワード 1,024 字まで | `src/app/api/auth/login/route.ts`・`src/app/api/auth/reset-link/route.ts` |
| Webhook `/api/webhooks/onvif/[storeId]`・`/api/bcp-webhook` | 店舗ごとの鍵・共有の Bearer | ONVIF は zod（`value` は 4,096 字まで） | 各 `route.ts`・[security-keys.md](security-keys.md) |
| cron `/api/cron/*` | `CRON_SECRET` | 本文を受けない | `vercel.json`・各 `route.ts` |
| Server Actions `src/app/**/actions.ts`（9 本） | ログイン | zod は `admin/stores/[id]/nvr/actions.ts` の 1 本だけ。残りは手書きの検査 | 各 `actions.ts` |

zod を通していない本文の受け口は 14 本です（2026-10-31 時点）: `metrics`・`security/patrol/ingest`・`auth/reset-link`・`alarms/frames/ingest`・`admin/stores/[id]/nvr/test-connection`・`admin/vod/cleanup`・`admin/import/stores`・`admin/import/cameras`・`edge/usage`・`sessions`・`bcp-webhook`・`bcp/test`・`livekit/token`・`livekit/publish`。多くは手書きで検査しています（`edge/usage` は `src/lib/edge-usage/report.ts`、CSV は §5）。手書きの検査に落ちた 400 は `input.invalid` に記録されません（§7 の R-5）。

## 2. 主な項目の決まり（2.1.1）

| 項目 | 決まり | 根拠 |
|---|---|---|
| ID（カメラ・店舗・セッションなど） | UUID | 各 `route.ts` の `z.string().uuid()` |
| 日時（録画の範囲） | 読める日時で 64 字まで（`+09:00` を受ける） | `src/app/api/vod/route.ts` の `IsoLike`・`src/app/api/edges/[id]/commands/route.ts` |
| 店舗の名前 | 1〜160 字。緯度 -90〜90・経度 -180〜180・タイムゾーン 64 字まで | `src/app/api/admin/stores/route.ts` |
| エッジの名前 | 1〜120 字 | `src/app/api/admin/edges/[id]/route.ts` |
| 更新の時間帯 | `HH:MM` | 同上 |
| カメラのチャンネル | 1〜64 | `src/app/api/admin/recorders/[id]/cameras/route.ts`・`src/app/api/admin/import/cameras/route.ts` |
| 16 分割の位置 | 0〜15 | 同上 |
| カメラの段（設置コード） | 16・32・48 のどれか | `src/app/api/admin/enrollments/route.ts` |
| 発報の種類 | `dedup_key` 200 字まで。`occurred_at` は今から 7 日前〜1 日後 | `src/app/api/alarms/ingest/route.ts` |
| 発報の前後の時点 | -5・0・5・10・20・30・60・180 秒のどれか | `src/lib/alarms/timeline.ts` |
| エッジの出来事 | `event_type` は列挙。`message` 500 字まで | `src/app/api/edge/events/route.ts` |
| BCP の時点 | -60〜1,440 分。ページ 1〜4,096 | `src/app/api/edge/bcp-shot-upload-url/route.ts`・`bcp-grid-upload-url/route.ts` |
| 配布物の版 | `[0-9A-Za-z._+-]` の 1〜64 字。形式 `deb`・`rpm`、CPU `amd64`・`arm64` | `src/lib/admin/nvmsd-releases.ts` |
| 配布物の署名 | 印字できる ASCII の 16〜4,096 字（中身は解釈しない） | `src/app/api/admin/nvmsd-releases/route.ts` |
| 要望の本文・返事 | 1,000 字まで（サロゲートペアを 1 字に数える）。本文は電話番号・メール・URL・IP を伏せ字にして保存 | `src/lib/feedback/schema.ts`・`src/lib/feedback/redact.ts` |
| 要望の context | 既知の項目だけ残す。4 KB まで | `src/lib/feedback/schema.ts` |
| 要望の該当の画面の URL | 500 字まで。画面の場所だけ残し、形の違うものは捨てる | `src/lib/feedback/image.ts` |
| 手荷物検査の設定 | 保持 1〜365 日・NVR の保持 3〜90 日・時間切れ 30〜600 秒・カメラ 2 台まで・通知のメール 10 件まで・手順 10 件まで・同意文 4,000 字まで | `src/app/api/admin/baggage-settings/route.ts`・`src/app/api/baggage/settings/route.ts` |
| 上流の住所（`hls_url`・`live_host`・`vod_host`） | `isUpstreamAddress`（300 字まで）。空は「使わない」 | `src/app/api/admin/recorders/[id]/route.ts`・`cameras/route.ts` |
| 発報の Webhook の宛先 | https だけ・2,000 字まで・内部の住所を断る | `src/lib/alarms/webhook-url.ts` |
| パスワード | [authentication-policy.md](authentication-policy.md) §3 | `src/lib/auth/password-policy.ts` |
| 利用状況の報告 | キーは `[a-z0-9._]` の 1〜64 字。1 つの表に 200 件まで | `src/lib/edge-usage/report.ts` |

長さの上限を書いていない文字列があります（カメラの名前・利用者の表示名・店舗の住所・録画機の利用者名など）。今は Vercel の本文の上限 4.5 MB が頭打ちです（§7 の R-4）。

## 3. 組み合わせの整合の決まり（2.1.2）

サーバの接続（service_role）で書く受け口は RLS が効かないので、**値の組み合わせをコードで確かめます**。

### 3.1 所属の組み合わせ

| 組み合わせ | 決まり | 見ている場所 |
|---|---|---|
| カメラと店舗（発報） | カメラはエッジの店舗のものだけ。確かめられなければ記録しない（DB の `store_of_camera`） | `src/lib/alarms/camera-scope.ts`・`src/app/api/alarms/ingest/route.ts`・`src/app/api/alarms/frames/ingest/route.ts` |
| 発報とエッジ | 発報はエッジと同じ店舗のものだけ | `src/app/api/alarms/frames/ingest/route.ts` |
| 巡回とエッジ | 巡回はエッジと同じ店舗のものだけ（カメラは見ていない・§7 の R-1） | `src/app/api/security/patrol/ingest/route.ts` |
| BCP の 1 枚とエッジ | 先置きの行がある組だけ。カメラ（か録画機）はこのエッジのもの。合成は発令の店舗もエッジと同じ | `src/app/api/edge/bcp-shot-upload-url/route.ts`・`bcp-grid-upload-url/route.ts` |
| 録画のクリップとエッジ | `edge_device_id` が一致。`ready` の行には発行しない | `src/app/api/edge/clip-upload-url/route.ts` |
| 診断の束とエッジ | 発行した `request_id` で、このエッジの分で、`pending` のものだけ | `src/app/api/edge/diagnostics/upload-url/route.ts` |
| 遠隔視聴とエッジ | `edge_id` の一致を条件に含める。動いている HLS のセッションだけ | `src/app/api/edge/video/status/route.ts`・`video/upload-urls/route.ts` |
| ライブ画像の送り先とエッジ | 経路の `[id]` とトークンのエッジが一致 | `src/app/api/edges/[id]/image-upload-url/route.ts` |
| 要望の画像と要望 | そのエッジのその `local_id` の要望だけ。大きさ・先頭の印・種類・sha256 が宣言と一致 | `src/app/api/edge/feedback/attachment/route.ts`・`src/lib/feedback/image.ts` の `checkAttachment` |
| カメラと利用者 | 画面からの視聴・録画の依頼は、RLS の下でカメラが見えること | `src/app/api/video/sessions/route.ts`・`src/app/api/vod/route.ts` |
| 店舗とテナント（利用者の割り当て） | `store_ids` は実効テナントの店舗だけ。`tenant_admin` は自テナントだけ | `src/app/api/admin/users/route.ts` |
| テナントと店舗（CSV） | 書き込みは RLS の下で行う。行ごとにテナントの契約と数量を確かめる | `src/app/api/admin/import/stores/route.ts` |
| カメラと録画機（CSV） | 書き込みは RLS の下で行う | `src/app/api/admin/import/cameras/route.ts` |
| カメラと店舗（手荷物検査の設定） | その店舗の配下のカメラだけ | `src/app/api/baggage/settings/route.ts` |
| 従業員と店舗（キオスク） | 自店舗の従業員だけ | `src/app/api/baggage/kiosk/sessions/route.ts` |
| キオスクの写真の経路と店舗 | `isKioskPhotoPath` で自店舗の経路の形そのものだけ | 同上・`src/lib/security/input.ts` |
| 拠点の https の名前と IP | ラベルの形と、IP が私設の IPv4 であること | `src/app/api/admin/edges/[id]/site-host/route.ts`・`src/lib/edge/site-tls.ts` |
| サインインの戻り先と拠点 | ループバック・私設の IP・その拠点の https の名前など、決めたホストだけ | `src/lib/edge/gvms-oidc.ts` の `allowedRedirectHost`・仕様書 §9 |

### 3.2 時刻と窓の組み合わせ

| 組み合わせ | 決まり | 見ている場所 |
|---|---|---|
| 録画のクリップの開始と終了（旧 VOD） | 開始が終了より前。4 時間を超えたら **400 で断る** | `src/app/api/vod/route.ts` |
| 録画再生の開始と終了（遠隔視聴） | 開始が終了より前。終了を省くと 60 分。4 時間を超えたら **4 時間に切る**（断らない）。未来は拠点が切る | `src/lib/video/session-logic.ts` の `normalizeVodRange` |
| 手荷物検査の窓 | 終わりが始まりより前なら断る。2 時間を超えたら断る。今から 15 分より離れていたら、長さを保ったまま今へ置き直す | `src/lib/baggage/inspection-flow.ts` の `normalizeInspectionWindow` |
| 発報の静音の時間 | `HH:MM` の形 | `src/app/alarms/actions.ts` |
| 手荷物検査の入退の順 | 退室はその人の未退室のセッションに結び付ける | `src/app/api/baggage/kiosk/sessions/route.ts` |

### 3.3 経路の組み合わせ

保存先の経路は**サーバが決めます**。エッジや画面に経路そのものを選ばせません（要望の画像 `<tenant_id>/<item_id>`・診断 `<edge_id>/<request_id>.tar.gz`・BCP `src/lib/edge/bcp-uplink.ts`・キオスク `<store>/<日付>/…`）。中継の経路は `safeSubPath`（`src/lib/proxy/upstream.ts`）で区切り文字と `.`・`..` を断ります。

## 4. 業務の上限の一覧（2.1.3）

### 4.1 利用者ごと

| 上限 | 値 | 根拠 |
|---|---|---|
| 要望（画面） | 1 利用者 1 日 20 件（日本時間で数える）。超えると 429 `daily_limit` | `src/lib/feedback/schema.ts` の `USER_DAILY_LIMIT`・`src/app/api/feedback/route.ts` |
| BCP の ZIP | 60 秒 2 回・1 時間 20 回 | `src/lib/limits/heavy.ts` |
| BCP の報告書 | 60 秒 3 回・1 時間 30 回 | 同上 |
| 月次の確定 | 60 秒 3 回・1 時間 30 回 | 同上 |
| CSV の取り込み | 60 秒 3 回・1 時間 30 回 | 同上 |
| 遠隔視聴のセッション | 60 秒 30 回・1 時間 600 回 | 同上 |
| 録画のクリップの依頼（使い回せないときだけ） | 60 秒 10 回・1 時間 120 回 | 同上 |
| 住所の座標 | 60 秒 10 回・1 時間 100 回 | 同上 |
| ログイン | メール 15 分 10 回・IP 15 分 30 回 | `src/app/api/auth/login/route.ts` |
| パスワードの再設定 | メール 1 時間 3 回・IP 1 時間 10 回 | `src/app/api/auth/reset-link/route.ts` |
| 再設定の番号 | メール 15 分 5 回・IP 1 時間 20 回 | `src/app/api/auth/recovery/verify/route.ts` |
| 多要素の番号 | 利用者 15 分 10 回 | `src/app/api/auth/mfa/route.ts`・`src/app/api/account/mfa/verify/route.ts` |
| 仮のパスワードの期限 | 72 時間 | `src/lib/auth/initial-password.ts` |

### 4.2 拠点・店舗ごと

| 上限 | 値 | 根拠 |
|---|---|---|
| 要望（拠点） | 1 拠点 1 日 50 件。超えると 429 `daily_limit` | `src/lib/feedback/schema.ts` の `EDGE_DAILY_LIMIT`・仕様書 §12.2 |
| 顔の照合 | 1 店舗 60 秒 30 回・1 時間 600 回 | `src/lib/limits/heavy.ts` |
| キオスクの PIN | 5 回失敗で 15 分ロック | `src/lib/baggage/kiosk-pin.ts` |
| 発報の重複 | 同じ店舗と `dedup_key` は `dedup_window_sec`（既定 120 秒）に 1 件 | `src/app/api/alarms/ingest/route.ts`・`alarm_settings` |
| エッジの出来事の重複 | 120 秒に 1 件 | `src/app/api/edge/events/route.ts` |
| エンロール | IP 1 時間 30 回。設置コードの期限 24 時間 | `src/app/api/edge/enroll/route.ts`・`src/lib/admin/enrollment.ts` |
| 録画機の一覧の問い合わせ | ID 32 件まで・既定 200 行 | `src/app/api/edge/recorders/route.ts` |
| ライブ画像の送り先の発行 | カメラ 64 台まで | `src/app/api/edges/[id]/image-upload-url/route.ts` |
| 分割の表示 | カメラ 16 台まで | `src/app/api/edges/[id]/commands/route.ts` |
| 同時の録画再生の画面 | 4 カメラまで（画面の決まり） | `src/app/stores/[id]/multi-vod/page.tsx` |
| 拠点へのサインインの許可 | 最後に使ってから（使っていなければ承認から）90 日で切れる（[authentication-policy.md](authentication-policy.md) §5） | `src/lib/edge/gvms-grants.ts` |

### 4.3 テナントごと

| 上限 | 値 | 根拠 |
|---|---|---|
| 同時視聴 | 既定 5。ライブと録画だけ数える。6 時間より古い未終了は数えない。テナントごとに 1〜1,000 | `supabase/migrations/20260810050000_start_live_session.sql`・`src/app/admin/limits/actions.ts` |
| 1 回の連続視聴 | 既定 120 分。テナントごとに 1〜1,440 分 | `supabase/migrations/20260707120000_session_duration_limit.sql`・`src/app/admin/limits/actions.ts` |
| 店舗数・巡回・発報・手荷物検査の店舗数 | `tenants.max_stores`・`max_patrol`・`max_alarm`・`max_baggage`（NULL は無制限）。読めないときは止めない（契約の枠で、守りの境界ではないため） | `src/lib/admin/tenant-quota.ts` |
| 月次の確定 | 同じテナントで 60 秒 3 回 | `src/lib/limits/heavy.ts` |

同時視聴と連続視聴は `POST /api/sessions`（`start_live_session`）で判定し、画面がそれに従います。中継の受け口と `POST /api/video/sessions` 自身は数えません（§7 の R-2）。

### 4.4 全体

| 上限 | 値 | 根拠 |
|---|---|---|
| BCP の ZIP | アプリ全体で 60 秒 20 本 | `src/lib/limits/heavy.ts` |
| BCP の報告書 | アプリ全体で 60 秒 20 本 | 同上 |
| Nominatim への問い合わせ | アプリ全体で 1 秒 1 回（OSM の約款） | 同上 |
| 本文の大きさ | Vercel の関数は 4.5 MB まで | [security-maintenance.md](security-maintenance.md) §3 |
| 回数の制限の判定 | DB の `rate_limit_hit`。**DB が答えないときは通す**（嫌がらせの対策で、認証の境界ではないため） | `src/lib/rate-limit.ts` |

### 4.5 1 回の処理の範囲

| 上限 | 値 | 根拠 |
|---|---|---|
| 録画再生・旧 VOD の長さ | 4 時間（`to` を省くと 60 分） | `src/lib/video/session-logic.ts`・`src/app/api/vod/route.ts` |
| BCP の ZIP | 2,000 ファイル・1 GiB | `src/app/api/bcp/[id]/snapshots.zip/route.ts` |
| BCP の試験の発令の半径 | 500 km | `src/app/api/bcp/test/route.ts` |
| CSV の行数 | 拠点 1,000 行・カメラ 5,000 行 | `src/lib/admin/csv.ts` |
| 要望の取り込み | 2,000 件 | `src/app/api/admin/feedback/import/route.ts` |
| 手荷物検査の窓 | 2 時間 | `src/lib/baggage/inspection-flow.ts` |
| 自動の削除 | 1 回の実行の上限（[data-classification.md](data-classification.md) §3） | `src/lib/retention/data-retention.ts` の `LIMITS` |

重い処理の理由は `src/lib/limits/heavy.ts` のコメントと [security-maintenance.md](security-maintenance.md) §3.2 にあります。値を変えるときは、コード・あの表・この文書を同じ日にそろえます。

## 5. 受け取るファイルの一覧（5.1.1）

「確かめ方」の **中身** は、サーバが中身のバイトを見ているかを指します。署名付きの URL へ直接置くものは、サーバを通らないので中身を見ていません。

### 5.1 サーバを通るもの（本文は 4.5 MB まで）

| ファイル | 受け口・送る人 | 形式 | 最大 | 保存先 | 確かめ方 |
|---|---|---|---|---|---|
| 拠点の CSV | `POST /api/admin/import/stores`（管理者） | CSV（画面は `.csv` だけを選ばせる。サーバは拡張子を見ない） | 1,000 行・本文の上限 | DB `stores`（ファイルは残さない） | `parseCsv` で読み、行ごとに検査。テナントの契約と数量 |
| カメラの CSV | `POST /api/admin/import/cameras`（管理者） | 同上 | 5,000 行・本文の上限 | DB `recorder_cameras` | チャンネル 1〜64・位置 0〜15。RLS の下で書く |
| 要望のファイル | `POST /api/admin/feedback/import`（運営） | JSON `gvms-feedback-export/1` | 2,000 件。本文の上限（画面が分けて送る） | DB と `feedback-attachments` | 1 件ずつ §2 の決まり。画像は `checkAttachment`。合わない画像は捨てて要望は入れる |
| 要望の画像（画面） | `POST /api/feedback`（テナントの管理者） | PNG・JPEG・WebP を 1 枚 | 3 MiB（3,145,728 バイト） | `feedback-attachments`（非公開・3 MiB・3 形式に限定）`<tenant_id>/<item_id>` | 先頭の印で形式を決める。sha256 を残す |
| 要望の画像（拠点） | `PUT /api/edge/feedback/attachment`（エッジ） | 同上 | 3 MiB（読みながら数える） | 同上 | 宣言との一致（大きさ・印・種類・sha256）。仕様書 §12.6 |
| 従業員の顔 | `POST /api/baggage/employees/[id]/face`（管理者） | JPEG・PNG の data URL | 15,000,000 字・本文の上限 | `baggage-photos`（非公開・10 MiB・3 形式に限定） | `decodeImageDataUrl`。AWS Rekognition へ登録 |
| キオスクの顔 | `POST /api/baggage/kiosk/face-auth` | JPEG・PNG の data URL | 本文の上限（画面は長辺 720 に縮める） | 同上 | `decodeImageDataUrl` |
| キオスクの名刺 | `POST /api/baggage/kiosk/photo` | JPEG・PNG・WebP の data URL | 本文の上限（画面は長辺 900 に縮める） | 同上 | `decodeImageDataUrl` |
| 発報のスナップ | `POST /api/alarms/ingest`（エッジ） | JPEG・PNG | 本文の上限 | `security-snapshots` | `sniffImage`。合わなければ保存しない |
| 発報の前後のスナップ | `POST /api/alarms/frames/ingest`（エッジ） | JPEG | 本文の上限 | 同上 | `sniffImage` |
| 巡回のスナップ | `POST /api/security/patrol/ingest`（エッジ） | JPEG・PNG を想定 | 本文の上限 | 同上 | **中身を見ていない**（§7 の R-1） |

### 5.2 署名付きの URL で直接置くもの（サーバを通らない）

| ファイル | 発行の受け口・送る人 | 形式 | 最大 | 保存先 | 確かめ方 |
|---|---|---|---|---|---|
| BCP の画像（カメラ個別・合成） | `/api/edge/bcp-shot-upload-url`・`bcp-grid-upload-url`（エッジ） | JPEG を想定（経路は `.jpg`） | 要確認（`bcp-clips` の設定がマイグレーションに無い） | `bcp-clips`（非公開） | 計画の行がある組だけ発行。**中身を見ていない** |
| 録画のクリップ（旧 VOD） | `/api/edge/clip-upload-url`（エッジ） | MP4 を想定 | 要確認（`vod-clips` の設定がマイグレーションに無い） | `vod-clips` | 所有の確認だけ。**中身を見ていない** |
| 手荷物検査のクリップ | `/api/baggage/edge/clip-upload`（エッジ） | MP4 | Storage は 100 MiB（`baggage-clips`・`video/mp4` に限定）。R2 は署名に大きさが入らず上限なし | R2 か `baggage-clips` | 署名に `video/mp4` を含める。**中身を見ていない**（§7 の R-3） |
| ライブ画像 | `/api/edges/[id]/image-upload-url`（エッジ） | JPEG（Worker が種類を `image/jpeg` に固定） | Worker のコードに上限なし | R2 `edges/<edge>/…` | Worker がキーの形と署名を見る。上書きのみ |
| 遠隔視聴の HLS | `/api/edge/commands/next` の開始の指示（`src/lib/video/dispatch.ts`）・`/api/edge/video/upload-urls`（拠点） | `video/mp2t`・`video/mp4`・`application/vnd.apple.mpegurl` | 1 本 32 MiB（`Content-Length` の申告で見る） | R2 `video/<session>/`（数分で消す） | Worker がキー・署名・種類を見る（`claude/cloudflare/edge-images/src/index.js`）。視聴者へは型を絞り `nosniff` で返す |
| 診断の束 | `/api/edge/diagnostics/upload-url`（拠点） | tar.gz（経路は固定） | 圧縮後 50 MiB（申告で見る。`diagnostics` の上限は 60 MiB）。**展開後の大きさは決めていない**（クラウドは展開しない） | `diagnostics`（非公開） | 発行した `request_id` だけ。中身を見ていない。読むのは運営だけ |
| nvmsd の配布物 | `/api/admin/nvmsd-releases/upload-url`（運営） | deb・rpm。`amd64`・`arm64` | 200 MiB（申告と `nvmsd-releases` の上限）。展開はしない | `nvmsd-releases`（非公開） | サーバが実体から sha256 と大きさを計算して台帳へ。**署名はクラウドでは解釈せず預かって配り、拠点が検証する**（仕様書 付録 A） |

`security-snapshots`・`bcp-clips`・`vod-clips`・`reports`・`bcp-reports` のバケットの大きさと形式の設定はマイグレーションにありません（`supabase/migrations` の `storage.buckets` は `baggage-clips`・`baggage-photos`・`nvmsd-releases`・`diagnostics`・`feedback-attachments` の 5 本だけ）。本番の設定は要確認です（§7 の R-6）。

### 5.3 利用者へ渡すときの守り

| 守り | 中身 | 根拠 |
|---|---|---|
| 非公開の置き場 | サーバが確かめてから 60 秒〜10 分の署名 URL を出す | [data-classification.md](data-classification.md) §2 |
| 型の固定 | 保存のときに、確かめた形式を種類に入れる（宣言をそのまま使わない。巡回を除く） | `src/lib/security/input.ts` |
| 中身の種類の推測を止める | 全体に `X-Content-Type-Options: nosniff` | `next.config.ts` |
| ダウンロードとして渡す | 診断の束・BCP の ZIP・BCP の報告書は添付で渡す | `src/app/api/admin/diagnostics/[id]/download/route.ts`・`src/app/api/bcp/[id]/snapshots.zip/route.ts`・`src/app/api/bcp/[id]/report/route.ts` |
| ZIP の中の名前 | `safeZipSegment` | `src/lib/security/input.ts` |
| HLS の中継 | 許した型だけ返し、それ以外は `application/octet-stream` | `src/lib/proxy/upstream.ts`・`src/app/api/video/sessions/[id]/hls/[...path]/route.ts` |

## 6. 悪性のファイルを見つけたときの扱い（5.1.1）

**今の実装:** ウイルス検査はありません。受け口は形式と大きさと署名を見ますが、中身が安全かは判定しません。悪性と分かったときに自動で動く仕組みもありません。

以下は**案です（発注者の決定前）**。

| 場面 | 案 |
|---|---|
| 検査の導入 | 利用者の端末で開かれる添付（要望の画像・診断の束）から、外部の検査の仕組みを検討する。画像は形式の確認を既に行っているので、まず診断の束を対象にする |
| 見つけた人 | 運営の担当が運用の連絡（`ALERT_EMAILS` の宛先）へ知らせる |
| 止める | 該当のファイルへの署名 URL の発行を止める。利用者向けの署名 URL は最長 10 分で切れる。送り元がエッジならデバイストークンの作り直しを検討する（[security-keys.md](security-keys.md)） |
| 残す | 調べるまで置き場のファイルは消さず、元の場所を読めない形にする。ファイルの sha256・経路・送り元・見つけた時刻を記録する |
| 消す | 調べ終えたらファイルと行を消し、`admin_audit_log` 相当の記録を残す（今は対応する `action` が無い） |
| 知らせる | テナントの管理者へ、該当の拠点と時刻を知らせる。個人データに関わるときは事故の手順に従う（手順は要確認） |
| nvmsd の配布物 | 拠点が署名で検証するので、署名の無い配布物は適用されない。署名された配布物に問題が見つかったら、目標の版を外して配布を止める |

## 7. 残（文書を書いて見つけたもの）

| # | 中身 | 要件 |
|---|---|---|
| R-1 | `POST /api/security/patrol/ingest` は `camera_id` の形と店舗の対応、画像の中身を確かめていない。発報の 2 本（`src/lib/alarms/camera-scope.ts`・`sniffImage`）と同じ確かめがまだ無い | 2.2.3・5.2.2 |
| R-2 | 同時視聴と連続視聴の上限は `/api/sessions` と画面で効く。`POST /api/video/sessions`・`/api/live-proxy`・`/api/vod-hls` は `session_limits` を見ない。`src/app/api/video/sessions/route.ts` のコメントと [security-maintenance.md](security-maintenance.md) §3.2 は「縛る」と書いている。連続視聴の 120 分は画面の時間切れ（`src/lib/useSessionCountdown.ts`）で、サーバは切らない | 2.1.3・2.4.1 |
| R-3 | `POST /api/baggage/edge/clip-upload` は `sessionId`・`cameraId` がそのエッジのものかを確かめていない。R2 への署名に大きさが入らない | 2.2.3・5.2.1 |
| R-4 | 長さの上限が無い文字列の項目がある（§2 の末尾）。`go2rtc_host` は形を見ず、送るときだけ確かめる。`live_rtsp` は形を見ない | 2.2.1 |
| R-5 | 手書きの検査の 400 は `input.invalid` に記録されない（§1） | 16.3.3 |
| R-6 | `security-snapshots`・`bcp-clips`・`vod-clips`・`reports`・`bcp-reports` のバケットの設定を本番で確かめ、マイグレーションに書く。署名付きの URL の大きさの上限はここに頼っている。[data-classification.md](data-classification.md) §5 の `reports` の公開の確認もある | 5.2.1 |
| R-7 | 署名付きの URL で置く BCP の画像・録画のクリップ・手荷物検査のクリップは、置いた後に中身を見ていない | 5.2.2 |
| R-8 | 診断の束の申告（50 MiB）と `diagnostics` の上限（60 MiB）が違う。展開後の大きさを決めていない（クラウドは展開しないが、開く人の端末で開く） | 5.1.1・5.2.3 |
| R-9 | `POST /api/edges/[id]/commands` はエッジが見えることを確かめるが、`camera_id`・`clip_id` がそのエッジのものかはこの受け口では見ていない（エッジ側で確かめているかは要確認） | 2.2.3 |
| R-10 | 録画の範囲の超過の扱いが受け口で違う（旧 VOD は断る・遠隔視聴は切る）。4 時間の定数が 2 か所にある（`src/app/api/vod/route.ts`・`src/lib/video/session-logic.ts`） | 2.2.3 |

## 8. 見直し

新しい受け口・ファイルの受け取り・上限を足すときに、この文書を同じ PR で直します。四半期の態勢監査（`docs/security-assessment.md`）のときに、§5 の表とコードの差を見直します。
