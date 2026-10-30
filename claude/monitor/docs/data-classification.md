# データの区分と守り方（G・VMS-Cloud）

作成: 2026-10-30 / 対象: `claude/monitor`（画面と API）・Supabase（DB・Storage・Auth）・Cloudflare R2・AWS Rekognition・Vercel
自主診断（ASVS 5.0 L2）の **14.1.1**（扱う機密のデータを洗い出し、保護の段階に分ける）と **14.1.2**（段階ごとの守り方を決める）の文書です。
顧客と合意する方針は `docs/data-governance-sla.md`（リポジトリの直下）にあり、この文書はその分類の表を細かくしたものです。両方が食い違ったら、この文書を実装に合わせて直し、方針の文書を追って直します。

**保持期間は 2026-10-30 に発注者が決めました**（§4）。決めた期間は日次の cron `/api/cron/data-retention`（UTC 03:30・`src/lib/retention/data-retention.ts`）と `/api/admin/vod/cleanup`（UTC 03:00）などで自動で消します。まだ決まっていない事項（拠点へのサインインの許可の期限など）は §4 に残しています。

---

## 1. 保護の段階

| 段階 | 名前 | 何か | 漏れたときの害 |
|---|---|---|---|
| **S** | 秘密 | 認証情報と鍵。それ自体で他の守りを破れるもの | 他人になりすます・他のデータをまとめて読まれる |
| **A** | 顔と身元 | 顔写真と顔の特徴量（個人情報保護法の個人識別符号）・名刺の写真・来訪者の氏名と会社 | 特定の人を、映像から長く追える。取り消しが効かない（顔は変えられない） |
| **B** | 映像と個人のデータ | 人が写り得る映像・画像、利用者のメールアドレス、IP、操作の記録 | 店舗の人の行動・誰が何を見たかが分かる |
| **C** | 運用 | 機器の構成・稼働の数字（個人を含まない） | 構成が分かる（攻撃の下調べ） |

## 2. 段階ごとの守り方（14.1.2）

| 項目 | S 秘密 | A 顔と身元 | B 映像と個人のデータ | C 運用 |
|---|---|---|---|---|
| 送るとき | TLS のみ。画面へは返さない（登録の 1 回だけの表示を除く） | TLS のみ | TLS のみ | TLS のみ |
| 置くとき | **ハッシュ（照合だけでよいもの）かアプリでの暗号化（AES-256-GCM）**。そのうえでプロバイダの保存時の暗号化 | 非公開の Storage・プロバイダの保存時の暗号化。公開の URL を作らない | 非公開の Storage・RLS の DB。公開の URL を作らない | RLS の DB |
| 渡し方 | 渡さない | サーバが確かめてから **60〜300 秒** の署名 URL | サーバが確かめてから署名 URL（60 秒〜10 分）か中継 | 画面・API（RLS） |
| 読める人 | サーバ（service_role）だけ | 店舗の担当（RLS の `baggage_store_access`）。表示は `footage_access_log` に残す | 店舗・テナントの担当（RLS）。映像の閲覧は `live_sessions`・`footage_access_log` に残す | 担当の利用者 |
| 完全性 | 照合の失敗は断る（定数時間で比べる） | 書くのはサーバだけ（エッジは自分のセッションの分だけ） | 書くのはサーバとその機器だけ。要望の添付は sha256 を残す | — |
| 保持 | 使う間だけ。作り直したら古いものを消す | **最短**（§3）。期限を過ぎたら自動で消す | §3 の期限で自動で消す | 運用に要る間 |
| ログへの出し方 | **出さない**（値・一部・ハッシュとも） | 出さない（ID とパスだけ） | メールアドレスと IP は出さない。安全の出来事は利用者の ID（UUID）と種類まで | 出してよい |
| ログの中の読める人 | — | — | Vercel のログは運営だけ。監査の画面はテナントの管理者が自テナントの分だけ | 運営 |
| DB の暗号化 | プロバイダの保存時の暗号化＋アプリでの暗号化 | プロバイダの保存時の暗号化 | プロバイダの保存時の暗号化 | 同左 |
| プライバシーの技術 | — | 顔は同意（`consent_at`・`consent_version`）を取ってから登録。来訪者の顔は当日のコレクションだけで照合し、翌朝に消す | 映像は防犯・監視の目的に限る。生の画像は期限で消し、長く残すのは確認済みの PDF | — |
| 外への委託 | — | AWS Rekognition（顔の登録と照合だけ・リージョンは `AWS_REGION`。AWS の改善への利用を断る設定（AI サービスのオプトアウトのポリシー）は §4 の確認事項） | Cloudflare R2（遠隔視聴の HLS・手荷物検査のクリップ） | — |

JWT（アクセストークン）と Base64 の Cookie は**誰でも中身を読めます**。載せてよいのは段階 B までの識別子（利用者の ID・メールアドレス・役割・拠点での役割 `gvms_role`・エッジの ID）だけで、段階 S と A は載せません。

| 読めてしまう値 | 中身 | 守り |
|---|---|---|
| アクセストークン（JWT） | `sub`・`email`・`role`・`aal`・`amr`・`session_id`・`app_metadata`、拠点向けは `client_id`・`gvms_role`、エッジは `app_metadata.edge_id` | 署名で改ざんを防ぐ。1 時間で切れる |
| ログインの Cookie（`__Host-gvms-auth`） | アクセストークン・更新トークン・利用者の情報（@supabase/ssr の形） | HttpOnly・Secure・`__Host-`。JavaScript から読めない |
| キオスクの Cookie（`bgk_session`） | 店舗の ID と期限 | HMAC の署名・12 時間 |
| ライブの中継の Cookie（`lp_<cameraId>`） | 期限とトンネルの住所 | HMAC の署名・10 分 |

## 3. データの一覧（14.1.1）

「保持（決定）」は 2026-10-30 に発注者が決めた期間、「消し方」はそれを実装した処理です。

### 3.1 段階 S（秘密）

| データ | 置き場所 | 置き方 | 保持 |
|---|---|---|---|
| 利用者のパスワード | Supabase Auth（`auth.users`） | bcrypt（Supabase） | アカウントを消すまで |
| 多要素の秘密（TOTP） | Supabase Auth（`auth.mfa_factors`） | Supabase の管理。登録のとき 1 回だけ画面に出す | 外すまで |
| refresh トークン | Supabase Auth（`auth.refresh_tokens`） | Supabase の管理 | 最長 7 日（拠点向けは 24 時間・`docs/authentication-policy.md` §5） |
| エッジの device token・設置コード | `edge_devices.device_token_hash`・`enrollment_tokens.token_hash` | SHA-256 の要約だけ（平文の列は消した） | 機器を外すまで |
| キオスクの PIN | `baggage_kiosk_pins.pin_hash` | scrypt（塩 16 バイト）・定数時間で比べる | 作り直すまで |
| NVR・レコーダのパスワード | `recorders.password_enc`・`vod_password_enc`・`edge_devices.auth_password_enc` | アプリでの AES-256-GCM（`packages/shared/src/secret-codec.ts`・v2 はエッジごとの鍵） | 機器を外すまで |
| サービスの鍵（service_role・Resend・AWS・R2・Cloudflare・LiveKit・署名の秘密・CRON_SECRET） | Vercel の環境変数・Supabase Vault（`bcp_webhook_secret`・`service_role_key` など） | プロバイダの管理 | 作り直すまで（`docs/dr-runbook.md` §5.4） |
| 通知の Webhook の URL | `alarm_settings.notify_webhook_url` | **平文**（URL に秘密を含むことがある） | 設定を変えるまで |

### 3.2 段階 A（顔と身元）

| データ | 置き場所 | 保持（決定） | 消し方 |
|---|---|---|---|
| 来訪者の顔写真 | Storage `baggage-photos`（`<store>/<日付>/`） | テナントの `retention_days`（既定 60 日・テナントで短くできる） | 日付ごと消す（`/api/cron/baggage-daily`） |
| 来訪者の顔の特徴量 | AWS Rekognition の当日のコレクション `baggage-<store>-<日付>` | 当日だけ | 翌朝にコレクションごと消す（直近 7 日分を見直す・`/api/cron/baggage-daily`） |
| 名刺の写真・来訪者の氏名と会社 | `baggage-photos`（`card-…`）・`inspection_sessions` | 来訪者の顔写真と同じ | 同上 |
| 従業員の顔写真 | `baggage-photos`（`employees/<store>/`）・`employees.face_photo_path` | **登録を外したら即時。加えて 1 年照合に使っていなければ消す**（決定 2026-10-30） | 登録を外す・顔を消す操作で即時に消す。消し残しと、`employees.face_last_matched_at`（登録した時刻か最後に照合で一致した時刻）が 1 年を過ぎた顔は `/api/cron/data-retention` が消す（従業員は登録のまま・キオスクで撮り直せば戻る）。どの従業員にも結び付いていない写真も、置いてから 1 日たてば消す |
| 従業員の顔の特徴量 | AWS Rekognition の常設のコレクション `baggage-emp-<store>`・`employees.rekognition_face_id` | 同上 | 同上（コレクションから DeleteFaces。消せなかった顔は列を残して次の日にやり直す） |
| 従業員の氏名・社員番号 | `employees` | **登録を外してから 1 年**（決定 2026-10-30） | `employees.deactivated_at`（登録を外した時刻・トリガで書く）が 1 年を過ぎた行を `/api/cron/data-retention` が行ごと消す。検査の記録（`inspection_sessions`）の従業員の欄は空になる |

### 3.3 段階 B（映像と個人のデータ）

| データ | 置き場所 | 保持（決定） | 消し方 |
|---|---|---|---|
| 発報のスナップ・前後のフレーム | Storage `security-snapshots`・`alarm_frames` | 31 日 | `/api/admin/vod/cleanup`※ |
| 録画のクリップ（VOD） | Storage `vod-clips` | 31 日 | 同上※ |
| 巡回のスナップ | `security-snapshots`・`patrol_runs`・`patrol_findings` | 31 日 | `/api/cron/security-patrol` |
| 手荷物検査のクリップ | Storage `baggage-clips` か R2 | `retention_days`（既定 60 日） | `/api/cron/baggage-daily` |
| 遠隔視聴の HLS（ライブ・録画の再生） | R2 `video/<session_id>/`（輪番で上書き） | 視聴の終わりから 2 分 | 5 分ごと・最長 7 分（`/api/cron/video-sessions`） |
| 遠隔視聴の記録 | `video_sessions`（利用者・視聴者の名前） | **180 日**（決定 2026-10-30） | 作ってから 180 日を過ぎ、置き場（R2）を消し終えた行（`purged_at` あり）を `/api/cron/data-retention` が消す |
| BCP の生画像 | Storage `bcp-clips`（`<発令の id>/` 以下）・`bcp_clips`・`bcp_grid_shots` | **90 日**（決定 2026-10-30。案の 1 年から短くした） | 発令（`bcp_events.created_at`）から 90 日を過ぎたら `/api/cron/data-retention` が置き場のファイルと行を消し、`bcp_events.raw_purged_at` に印を付ける。発令の行・レポートは残る。消した後は PDF の作り直しと録画の取り直しを断る（確認済みの PDF を画像の無いもので上書きしない） |
| BCP・巡回・月次のレポート（PDF） | Storage `bcp-reports`・`reports` | **契約の終わりまで**（決定 2026-10-30） | 自動では消さない。契約の終わりにテナントの削除（運営・`DELETE /api/admin/tenants/[id]`）で配下ごと消す |
| 要望の添付 | Storage `feedback-attachments` | 365 日 | `/api/cron/feedback-attachments`（種類と大きさと sha256 は残す） |
| 診断の束 | Storage `diagnostics` | 30 日 | 同じ機器で次の束を頼んだときにだけ消す（定期の処理で確実に消すのは §5 の残） |
| 利用者の情報 | `auth.users`・`admin_users`（メール・表示名・役割） | アカウントを消すまで | 管理の画面で消す |
| 管理操作の記録 | `admin_audit_log` | **5 年**（決定 2026-10-30） | `ts` が 5 年を過ぎた行を `/api/cron/data-retention` が消す |
| 証跡の静止画の閲覧の記録 | `footage_access_log` | 180 日 | `/api/admin/vod/cleanup`※ |
| 映像の閲覧の記録 | `live_sessions`（月ごとのパーティション） | **1 年**（決定 2026-10-30） | `started_at` が 1 年を過ぎた行を `/api/cron/data-retention` が消す（空になった古いパーティションは残る。落とすのは §5 の残） |
| 回数の制限の記録 | `rate_limits`（鍵にメールアドレスと IP が入る） | 1 日 | `/api/admin/vod/cleanup`※ |
| 安全の出来事 | Vercel のログ（`[security]`・利用者の ID・IP・パス・種類） | **90 日**（決定 2026-10-30） | **未実装**。Vercel のログの転送先（Log Drain）を決めてから、転送先の保持を 90 日にする。それまでは Vercel のログの保持（プランによる）のまま |

※ `/api/admin/vod/cleanup` は以前 POST と `x-cron-secret` しか受けず、Vercel Cron（GET・`Authorization: Bearer`）からは動いていませんでした。2026-10-29 に GET を受けるよう直しました（#432）。

`/api/cron/data-retention` は 1 回に消す数に上限があり（従業員 500 行・BCP 50 発令かつ 5,000 ファイル・記録の表は 1 万行ほど）、残りは次の日に回ります。置き場（と Rekognition）を先に消し、消せた分だけ行を消すので、失敗した分は次の日にやり直します。`?dry_run=1`（同じ認証）で数えるだけの実行ができます。消した従業員の顔と行は `admin_audit_log` に `retention.employee.*`（操作者なし・氏名は書かない）として残ります。

### 3.4 段階 C（運用）

機器・レコーダ・カメラの構成（`edge_devices`・`recorders`・`cameras`）、発報・巡回の出来事のメタ（`alarm_events` など）、稼働の数字（`metric_events`・90 日）。

### 3.5 使っていない古い表

基盤（reception）から引き継いだ `visitors`（名刺・顔の URL・電話・メール・住所）・`users`・`inspections`・`entry_exit_logs`・`unmatch_logs` は、G・VMS-Cloud のコードから使っていません。中身を確かめ、要らなければ消します（§5 の残）。

## 4. 発注者の決定と、確認が要る事項

| # | 事項 | 決定・案 | 状態 |
|---|---|---|---|
| D1 | 従業員の顔（写真と特徴量）の保持 | 登録を外したら即時。加えて 1 年照合に使っていなければ消す | **決定（2026-10-30）**・実装済み（`/api/cron/data-retention`） |
| D2 | 従業員の氏名・社員番号の保持 | 登録を外してから 1 年 | **決定（2026-10-30）**・実装済み（同上） |
| D3 | BCP の生画像の保持 | **90 日**（案の 1 年から短くした） | **決定（2026-10-30）**・実装済み（同上） |
| D4 | レポート（PDF）の保持 | 契約の終わりまで | **決定（2026-10-30）**（消さない） |
| D5 | 管理操作の記録の保持 | 5 年 | **決定（2026-10-30）**・実装済み（同上） |
| D6 | 映像の閲覧の記録（`live_sessions`）・遠隔視聴の記録（`video_sessions`）の保持 | 1 年・180 日 | **決定（2026-10-30）**・実装済み（同上） |
| D7 | 安全の出来事のログの保持と置き場所 | 90 日 | **決定（2026-10-30）**・未実装（Vercel のログの転送先を決めてから） |
| D8 | 使っていない古い表（§3.5） | 中身を確かめて消す | 案 |
| D9 | AWS Rekognition の置き場所と、AWS の改善への利用を断る設定 | 東京リージョン（`ap-northeast-1`）・AWS Organizations の AI サービスのオプトアウトのポリシーを入れる | 案 |
| D10 | 顔の照合を AWS へ委託することの、顧客への説明（`docs/data-governance-sla.md` の第三者提供の欄） | 委託として明記し、手荷物検査を使う顧客と合意する | 案 |

保持の期間を変えるときは、この文書・`docs/data-governance-sla.md` の保持の表・実装の定数（`src/lib/retention/data-retention.ts` の `RETENTION` など）を同じ日にそろえます。
同時ログインの数（上限なし）と拠点へのサインインの許可の期限は `docs/authentication-policy.md` §6 にあります（同時ログインは 2026-10-30 に上限なしで決定・許可の期限は未定）。

## 5. 残（この文書を書いて見つけたもの）

- `/api/admin/vod/cleanup` は 2026-10-29 に Vercel Cron の GET を受けるよう直した（#432）。本番の Cron の記録で毎日 200 になっていることを確かめる
- 従業員の顔・氏名・BCP の生画像・閲覧の記録・管理操作の記録の削除は 2026-10-30 に入れた（`/api/cron/data-retention`）。残りは診断の束を定期の処理で確実に消すこと・`live_sessions` の空になった古いパーティションを落とすこと
- 安全の出来事のログ（90 日）: Vercel のログの転送先（Log Drain）を決め、転送先の保持を 90 日にする
- 旧世代（QR）の従業員の `employees.photo_url` の中身と置き場所を確かめる（`/api/cron/data-retention` は `face_photo_path` の写真だけを消す）
- NVR のパスワードの暗号化の鍵（`SECRETS_ENC_KEY`）が無いと平文（`plain:`）で置く作りを、本番では断る形にする
- 通知の Webhook の URL（`alarm_settings.notify_webhook_url`）を段階 S として扱う（店舗の担当の利用者が読める）
- レポート（PDF）を `/storage/v1/object/public/reports/…` の URL で渡している。`reports` バケットが公開なら、非公開にして署名 URL へ替える
- `bcp-clips` は非公開にしたが、`/api/edge/bcp-grid-complete` が公開の URL（`getPublicUrl`）を `clip_url` に書き続けている（表示は署名 URL なので漏れはしないが、使えない URL が残る）

## 6. 見直し

新しい種類のデータを足すとき（新しい表・バケット・外部サービス）、保持の期限を変えるとき、四半期の態勢監査（`docs/security-assessment.md`）のときに見直します。新しいデータは、置く前にこの文書の §3 に段階と保持を書きます。
