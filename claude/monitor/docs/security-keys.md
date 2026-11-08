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
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase の新しい形式の secret キー（`sb_secret_`・名前 `vercel_monitor`・RLS を通らない）。2026-11-09 に旧式（JWT）から替えた | サーバの DB・Storage の操作（`createSupabaseService`） | **ほかの鍵の元にしない**。画面・エッジへ渡さない（G・VMS の拠点へは渡さない・#403） | なし | §5。旧式の鍵は 2026-11-09 から止める手順の途中 |
| `JALERT_INVOKE_SECRET`（関数の秘密）・Vault の `jalert_invoke_secret` | 共有の Bearer（乱数 32 バイト） | pg_cron の `invoke_jalert_poller` → Edge Function `jalert-poller` の呼び出しだけ（`supabase/functions/jalert-poller/auth.ts`） | ほかの受け口 | Supabase の中だけ（Vault と関数の秘密） | 両方を同じ値に（§5 の 2・3） |
| 秘密の鍵 `jalert_poller`（Supabase の secret キー） | Supabase の新しい形式の secret キー | `jalert-poller` の DB の操作だけ。関数には Supabase が `SUPABASE_SECRET_KEYS` で自動で渡す（値を写さない） | ほか | なし | Supabase の画面で作り直す（関数は次の起動から新しい鍵） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase の publishable キー | 画面からの認証（公開してよい） | 権限の判定に使わない（RLS が判定する） | 画面 | Supabase の画面 |
| `KIOSK_SESSION_SECRET` | HMAC-SHA256（用途の名前 `baggage-kiosk-session-v2` で導いた鍵） | 手荷物検査のキオスクの PIN のセッション（12 時間・店舗限定） | ほかの署名 | なし | 替えるとキオスクは PIN を入れ直す。**未設定なら service_role の鍵から導く（移行の間だけ）** |
| `LIVE_SIGNING_SECRET` | HMAC-SHA256（`${pathname}\n${exp}`） | live-gate（Cloudflare Worker）へ渡す Frigate の MJPEG の URL の署名 | live-proxy のクッキー（2026-10-30 に分けた） | Worker `live-gate` | Vercel と Worker を同じ値に |
| `LIVE_PROXY_COOKIE_SECRET` | HMAC-SHA256（`${cameraId}\n${origin}\n${exp}`） | live-proxy（HLS の中継）のクッキー（10 分） | live-gate の URL の署名 | なし | 替えると出ていたクッキーはフル認証に落ちるだけ（視聴は止まらない）。**未設定なら LIVE_SIGNING_SECRET から用途の名前 `live-proxy-cookie-v1` で導く** |
| `EDGE_IMAGES_SIGNING_SECRET` | HMAC-SHA256（`${method}\n${key}\n${exp}`） | 置き場の Worker（R2）への GET・PUT・DELETE の URL の署名（ライブ画像・映像の受け渡し） | ほかの署名 | Worker（画像） | Vercel と Worker を同じ値に |
| `SECRETS_ENC_KEY`・`SECRETS_ENC_KEYS` | AES-256-GCM（タグ 16 バイト・IV 12 バイト）。v2 はエッジごとの鍵を HKDF-SHA256（salt=エッジの ID） | 録画機・VOD の資格情報の暗号化（`packages/shared/src/secret-codec.ts`） | 署名・ほかのデータの暗号化 | エッジには自分の鍵だけ（bootstrap） | ID つきで並べて `POST /api/admin/secrets/rewrap` |
| `CRON_SECRET` | 共有の Bearer | Vercel の cron の受け口だけ | ほかの受け口 | Vercel | Vercel の画面 |
| `BCP_WEBHOOK_SECRET` | 共有の Bearer（未設定はフェイルクローズ） | BCP の webhook の受け口だけ | ほかの受け口 | 送り手 | 送り手と同時に |
| `ONVIF_WEBHOOK_SECRET` | 店舗ごとの鍵の元の鍵（そのものは Bearer として受けない・2026-10-31） | 店舗ごとの鍵を作る（HMAC-SHA256・店舗 ID を混ぜる）。ONVIF の webhook はその店舗の鍵だけを受ける | ほかの店舗の受け口・ほかの受け口 | 各店舗の NVR（店舗の鍵だけ） | 作り直すと全店舗の鍵が変わる（NVR の設定をやり直す） |
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

## 5. service_role の鍵の作り直し（旧式の JWT から新しい形式へ・2026-11-09）

10/28 の自主診断で、エッジの bootstrap が G・VMS の拠点にも service_role の鍵を返していたと分かった（#403 で直した）。
返していた値（旧式の鍵・`eyJ…`）は流れたものとして扱い、使えなくする。旧式の鍵は 1 本だけ止められず、
Supabase の画面で「旧式の鍵（anon と service_role）をまとめて止める」しかないので、先に旧式の鍵に頼る所をすべて新しい形式へ移す。

値はどれも画面に出さない（`openssl rand -base64 32 | tr -d '=+/' | pbcopy` のようにクリップボードへ送る・チャットや PR に貼らない）。

| 段 | 操作 | 誰が | 確かめ |
|---|---|---|---|
| 1 | Supabase → API Keys → Secret keys に `vercel_monitor` を作り、Vercel の `SUPABASE_SERVICE_ROLE_KEY`（Production・Preview）を貼り替えて再デプロイ | 発注者 | **2026-11-09 済**。主な画面・拠点の生存報告・サーバの記録のエラー 0 |
| 2 | Secret keys に `jalert_poller` を作る（関数へは自動で渡る）。合言葉を作り、Edge Functions → Secrets に `JALERT_INVOKE_SECRET` と `JALERT_ALLOW_LEGACY_INVOKE`=`1` を置く | 発注者 | `supabase secrets list` に名前が出る |
| 3 | SQL Editor で `select vault.create_secret('<合言葉を貼る>', 'jalert_invoke_secret');`（段 2 と同じ値） | 発注者（本番の DB） | `select name from vault.secrets` に名前が出る |
| 4 | この PR をマージ（Vercel の点検は Vault の `jalert_invoke_secret` を見るようになる） | 発注者の OK | 再デプロイ |
| 5 | `supabase functions deploy jalert-poller --no-verify-jwt` | 担当 | 関数の版が上がり verify_jwt が false |
| 6 | 移行 `20261109090000_jalert_invoke_secret.sql` を **db query で 1 本だけ**入れる（`db push` は使わない） | 担当（発注者の OK） | 毎分の起動が 200（関数のログ・`net._http_response`） |
| 7 | `supabase secrets unset JALERT_ALLOW_LEGACY_INVOKE`、Vault の `service_role_key` を消す（`delete from vault.secrets where name = 'service_role_key';`） | 発注者 | 起動が 200 のまま |
| 8 | Vercel の `NEXT_PUBLIC_SUPABASE_ANON_KEY` を新しい公開用の鍵（`sb_publishable_`）へ貼り替えて再デプロイ | 発注者 | ログイン・画面・リアルタイムの更新 |
| 9 | Supabase → API Keys → Legacy API Keys を止める（Disable） | 発注者 | 画面・拠点の報告・J アラートの起動・監査の記録の書き出し（13:00）が通る。旧式の鍵での読み取りが断られる |

- 段 5 の後は、関数は合言葉か（段 7 までは）旧式の鍵だけを受ける。公開用の鍵では起動できない（以前は入口の JWT の確かめだけで、公開用の鍵でも起動できた）
- 戻すとき: 段 9 は画面で Enable に戻せる。段 7 までは `JALERT_ALLOW_LEGACY_INVOKE=1` と Vault の `service_role_key` を戻せば以前の形
- 試作のエッジ箱（intereco-edge・出荷前）は bootstrap で 5 分ごとに鍵を取り直すので、段 1 の後は新しい鍵で動く。G・VMS の拠点（nvmsd）は Supabase の鍵を使わない（ログインの一本化は JWKS で確かめる）
- 終わったら: 自主診断の記録（NVMS `docs/security/asvs_l2_記録.csv` 13.3.2）とこの表の「作り直し」を書き換える
