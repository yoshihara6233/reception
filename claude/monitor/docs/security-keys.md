# 鍵と暗号の一覧（G・VMS-Cloud）

作成: 2026-10-30 / 対象: `claude/monitor`（Next.js・Vercel）と、それが鍵を分け合う Cloudflare Worker・エッジ
自主診断（ASVS 5.0 L2）の **11.1.2**（暗号の一覧: 鍵・方式・証明書と、鍵を使ってよい所・いけない所）の文書です。
G・VMS（拠点）の側の一覧は NVMS の `docs/security/鍵と暗号.md` にあります。

**決まり**: 1 本の鍵は 1 つの用途だけに使います。同じ値から別の用途の鍵が要るときは、用途の名前で導きます（HMAC-SHA256 か HKDF-SHA256）。鍵を足したら、この表に行を足します。

---

## 1. 鍵（環境変数）

値はすべて Vercel の環境変数（Production / Preview）にだけ置き、リポジトリ・ログ・応答には出しません。作るときは `openssl rand -base64 32 | pbcopy` のように、画面に出さずにクリップボードへ送ります。

| 鍵 | 方式 | 使ってよい所 | 使ってはいけない所 | 共有先 | 作り直し |
|---|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase の secret キー（RLS を通らない） | サーバの DB・Storage の操作（`createSupabaseService`） | **ほかの鍵の元にしない**（2026-10-30 にキオスクの鍵の元から外した・未設定の間だけ以前の作り方が残る）。画面・エッジへ渡さない | なし | 11 月下旬に予定。先に `KIOSK_SESSION_SECRET` を足しておく（足していないとキオスクが全部ログアウトする） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase の publishable キー | 画面からの認証（公開してよい） | 権限の判定に使わない（RLS が判定する） | 画面 | Supabase の画面 |
| `KIOSK_SESSION_SECRET` | HMAC-SHA256（用途の名前 `baggage-kiosk-session-v2` で導いた鍵） | 手荷物検査のキオスクの PIN のセッション（12 時間・店舗限定） | ほかの署名 | なし | 替えるとキオスクは PIN を入れ直す。**未設定なら service_role の鍵から導く（移行の間だけ）** |
| `LIVE_SIGNING_SECRET` | HMAC-SHA256（`${pathname}\n${exp}`） | live-gate（Cloudflare Worker）へ渡す Frigate の MJPEG の URL の署名 | live-proxy のクッキー（2026-10-30 に分けた） | Worker `live-gate` | Vercel と Worker を同じ値に |
| `LIVE_PROXY_COOKIE_SECRET` | HMAC-SHA256（`${cameraId}\n${origin}\n${exp}`） | live-proxy（HLS の中継）のクッキー（10 分） | live-gate の URL の署名 | なし | 替えると出ていたクッキーはフル認証に落ちるだけ（視聴は止まらない）。**未設定なら LIVE_SIGNING_SECRET から用途の名前 `live-proxy-cookie-v1` で導く** |
| `EDGE_IMAGES_SIGNING_SECRET` | HMAC-SHA256（`${method}\n${key}\n${exp}`） | 置き場の Worker（R2）への GET・PUT・DELETE の URL の署名（ライブ画像・映像の受け渡し） | ほかの署名 | Worker（画像） | Vercel と Worker を同じ値に |
| `SECRETS_ENC_KEY`・`SECRETS_ENC_KEYS` | AES-256-GCM（タグ 16 バイト・IV 12 バイト）。v2 はエッジごとの鍵を HKDF-SHA256（salt=エッジの ID） | 録画機・VOD の資格情報の暗号化（`packages/shared/src/secret-codec.ts`） | 署名・ほかのデータの暗号化 | エッジには自分の鍵だけ（bootstrap） | ID つきで並べて `POST /api/admin/secrets/rewrap` |
| `CRON_SECRET` | 共有の Bearer | Vercel の cron の受け口だけ | ほかの受け口 | Vercel | Vercel の画面 |
| `BCP_WEBHOOK_SECRET`・`ONVIF_WEBHOOK_SECRET` | 共有の Bearer（未設定はフェイルクローズ） | それぞれの webhook の受け口だけ | ほかの受け口 | 送り手 | 送り手と同時に |
| `LIVEKIT_API_KEY`・`LIVEKIT_API_SECRET` | LiveKit のトークン（JWT・HS256） | SFU の部屋のトークン（2026-09-29 から保留） | ほか | LiveKit Cloud | LiveKit の画面 |
| `GO2RTC_CF_ACCESS_CLIENT_ID`・`_SECRET` | Cloudflare Access のサービストークン | 許した名前の拠点の go2rtc への中継だけ（`lib/proxy/upstream.ts`） | ほかのホスト | Cloudflare Access | Cloudflare の画面 |
| `AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY` | AWS の IAM キー | Rekognition（手荷物検査の顔の照合） | ほかの AWS の操作 | AWS | IAM の画面 |
| `R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY` | R2 の S3 API キー | 置き場の読み書き（Worker が無いとき） | ほか | Cloudflare | Cloudflare の画面 |
| `RESEND_API_KEY`・`CLOUDFLARE_API_TOKEN` | API キー | メールの送信・拠点の名前の DNS（ゾーン 1 つの編集だけ） | ほか | 各社 | 各社の画面 |

## 2. 利用者・端末の秘密（DB に置くもの）

| もの | 方式 | 置き方 |
|---|---|---|
| 利用者のパスワード・多要素（認証アプリの番号） | Supabase Auth（bcrypt・TOTP） | Supabase Auth の中。アプリは持たない |
| エッジの端末トークン | 乱数 32 バイト（`randomBytes(32)`） | SHA-256 のハッシュだけを保存（`lib/edge/device-token.ts`） |
| エンロールコード | 乱数 | SHA-256 のハッシュだけを保存（`lib/admin/enrollment.ts`） |
| キオスクの PIN | scrypt（salt 16 バイト・32 バイト） | ハッシュだけを保存（`lib/baggage/kiosk-pin.ts`）。照合は定数時間 |
| 録画機の資格情報 | AES-256-GCM（§1 の `SECRETS_ENC_KEY(S)`） | 暗号文（`enc:v2:`） |

## 3. ハッシュ・乱数・証明書

- **ハッシュ**: SHA-256（更新の配布物の照合・トークンのハッシュ・要望の添付画像の照合・middleware のトークンの覚え）。MD5・SHA-1 は使いません。
- **乱数**: `node:crypto` の `randomBytes`・`randomUUID`（Web では `crypto.getRandomValues`）。`Math.random` を秘密に使いません。
- **署名の比較**: `timingSafeEqual`（定数時間）。
- **証明書（TLS）**: `gvms-cloud.com` は Vercel が発行・更新します。拠点の https（`*.sites.genesis-edge.com`）の証明書は拠点が取り、クラウドは DNS の TXT を書くだけです（`CLOUDFLARE_API_TOKEN`）。

## 4. 見直し

鍵を足す・用途を変える・方式を変えるときにこの表を直します。四半期ごとの態勢監査（`docs/security-assessment.md`）で、`process.env.*SECRET*` の使う所とこの表がずれていないかを確かめます。
