---
name: intereco-patterns
description: >-
  Durable gotchas and code patterns for the Intereco Recorder Monitor
  (本部監視 Next.js on Vercel + 現地エッジ edge-agent + Supabase + Frigate/Uniview/i-PRO NVR).
  Reference when touching: Supabase auth/Storage, the camera live/grid/VOD views,
  Cloudflare Tunnel remote viewing, key rotation, or Vercel deploy. These cost
  real debugging time in the 2026-06-13 session — read before re-solving them.
---

# Intereco 監視システム — 実装パターン集（知見）

対象: `claude/monitor`（Next.js）+ `claude/edge-agent`（Bun）+ Supabase + Frigate/go2rtc/cloudflared。
本番: `https://intereco-monitor.vercel.app`（Vercel project `intereco-monitor`, 本番ブランチ `monitor-prod`）。

## 1. Supabase 新APIキー形式（最重要の落とし穴）

本番プロジェクト `vywvpcjbicrtcyvzmrwh`（**2026-07-19 に Mumbai→Tokyo 移行**。旧 `jmlviywilxzavjbmlpnf` は廃止・使用禁止）。キーは新形式のみ運用（旧プロジェクトではレガシーJWT無効化済みだった。新プロジェクトのレガシーJWT無効化は未実施→設定推奨）。新形式
`sb_publishable_…`（=anon相当）/ `sb_secret_…`（=service_role相当）を使う。

- **raw `fetch()` で Storage を叩く時は `apikey` ヘッダが必須**。`Authorization: Bearer <key>` だけだと
  **502**（旧JWTはBearerだけで通っていた）。JS SDK(`@supabase/supabase-js`)は両方送るので問題なし。
  ```ts
  headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  ```
  該当: `monitor/src/app/api/edges/[id]/grid/route.ts`, `.../cam/[cameraId]/snapshot/route.ts`。
- **env名**: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`(=publishable) / `SUPABASE_SERVICE_ROLE_KEY`(=secret)。
- ~~`live_host` 等はadmin UIに編集欄が無い → Supabase SQL Editor で直接UPDATE~~ → **R2で解消済（2026-07-07）**：
  `live_host`/`vod_host`/`vod_username`/`vod_password`/`vod_channel` は `/admin/edges/[id]` の RecorderCard「詳細(ライブ/VOD/go2rtc)」パネルで編集可（API `/api/admin/recorders/[id]` PUT・PWはVault暗号化・監査ログ記録）。SQL直編集は不要。

## 1.5 R2移行で壊れた2つの暗黙前提（2026-08-04・本番で踏んだ）

grid/snapshot ルートは R2 にオブジェクトがあると `img.genesis-edge.com` へ **302** する。
これが次の2つの「書かれていない前提」を壊した。**同種の移行では必ず両方を確認する。**

1. **「同一オリジンだから fetch できる」** — `lib/saveJpeg.ts` は fetch→blob で保存する。
   302 先の Worker に `Access-Control-Allow-Origin` が無いため **fetch だけ CORS で失敗**
   （`<img>` は CORS 不要なので表示は成功）。症状は「見えているのに『保存失敗』」。
   16分割は R2 にオブジェクトがあり失敗、シングルは R2 未作成で Supabase へ落ちて成功、
   という**非対称が切り分けの決め手**になった。
   対処: 保存時のみ `?download=1` でルートにバイトを中継させる（`lib/storage/edge-image-response.ts`）。
   Worker に CORS を足す案は却下 — Vercel プレビューはオリジンが毎回変わり許可リストが破綻する。
2. **「Supabase にも最新がある」** — 移行前はエッジが毎フレーム両方に書いていたので
   フォールバックが成立していた。移行後は **R2 成功時に早期 return** するため Supabase 側は
   移行時点で凍結＝**必ず古い**。`workerImageExists` の否定判定 60 秒メモ化と重なり、
   ライブ開始直後の60秒間ずっと古いフレームを表示していた。
   対処: 否定メモを 3 秒に短縮＋ R2/Worker 構成済みなら Supabase へ落とさず 503
   （監視用途で古い映像を黙って出すのは「今を見ている」誤認を生むため）。

**SFU が「途中で止まる」のは仕様**（`state-machine.ts startSfu` が `stopSfu()` してから貼り替え）。
同時 publish は 1 本。UI に明示していないと必ず不具合報告になる（2026-08-04 に表示を追加）。

## 1.6 migration を含む PR は「マージ＝デプロイ」に間に合わない（2026-08-06 全エッジ停止）

Vercel はマージした瞬間に新コードを本番へ出すが、**Supabase の migration は誰かが
`db push` するまで当たらない**。`scoped_only` 列を足す PR をマージし、migration を
当て忘れたため、`/api/edge/bootstrap` の SELECT が列不在で失敗した。

**手順（migration を含む PR は必ずこの順）**:
1. `bunx supabase migration list` で**接続先が東京DB `vywvpcjbicrtcyvzmrwh` か**を確認（旧refに向いて誤爆した実績あり）
2. `bunx supabase db push` で先に列を作る
3. そのうえで PR をマージ（新列は「あっても古いコードは読まない」ので先行適用は安全）

**列追加は必ず `add column if not exists` + `default`**。既存行を壊さず、
push 前にデプロイが走っても Not Null 違反にならない。

**症状の見分け方**: このときエッジ側のログは `bootstrap: non-OK response status:401` で、
トークン不正と全く同じ見た目だった。→ bootstrap は**トークン不一致(401)とサーバ側失敗(500)を
分けて返す**ようにした（`api/edge/bootstrap/route.ts`）。401 が出たら現地のトークンを、
500 が出たら本部の migration を疑う、と切り分けられる。

## 1.7 i-PRO NVR 経由（カメラ網が分離された現場）は JPEG では成立しない（2026-08-06 実機）

NU101 は `push.cgi COMP=JPEG` に対し、**JPEG 配信を持たないカメラへ 39×37 のプレースホルダを
HTTP 200 で返す**。バイト列は正しい JPEG なので SOI/EOI 判定では通ってしまい、グリッドに
黒いセルが並ぶだけでエラーにならない。→ `COMP=H265|H264` を受けて**エッジでデコード**する
方式に変更（`adapters/i-pro/nvr-rtp.ts`）。カメラの配信設定に一切依存しない。

- **各 multipart パートがちょうど RTP パケット1個**。独自フレーミングは無い。PT 98=H.264 / 101=H.265。
  RTP 拡張にカメラ番号(0x0004)と時刻(0x0007)が載るので読み飛ばす。
- **ONVIF は無い**（`/onvif/device_service` は 404・RTSP 554 も閉）。チャンネル列挙は
  `as_getinfo.cgi?FILE=2` の `CAM_CONNECT_xxCH`。接続テストも push.cgi で判定する。
- **ユーザ名は NVR 本体の管理者（既定 `ADMIN`）**。カメラ側の `admin` を入れると
  `dlogin.cgi` が 401 になりライブが一切出ない。UI 既定値も `ADMIN` に修正済み。
- 機器が返す極小画像は `util/jpeg.ts` の `assertUsableJpeg` で弾き、**取得失敗として扱う**
  （黙って表示すると現地で原因に辿り着けない）。

## 2. service_role 鍵ローテはエッジ.envも同期（でないと全停止）

鍵をローテ（旧失効）したら **エッジの env も新キーに更新 → restart**。env の正しい場所（2026-07-19確定）:
- `intereco-edge`（OTA稼働）: **`/home/intereco/edge/shared/agent.env`**（systemd EnvironmentFile）
- `intereco-edge-demo`: `/home/intereco/intereco/claude/edge-agent/.env.demo`
- ⚠ 旧パス `/home/intereco/intereco/claude/edge-agent/.env` の編集は**無効**（OTA化で移動済み。Tokyo移行時もこれで長時間ハマった）
更新後 `sudo systemctl restart intereco-edge`（demo は intereco-edge-demo）。
旧キーのままだとエッジが `Unregistered API key` でheartbeat/grid/snapshotが全停止する。
将来は「初回ブート登録(pull型)」で鍵配布を一元化する設計（docs参照）。

## 3. ライブ視聴（MJPEG/スナップ）の描画とポーリング

- **MJPEG (`multipart/x-mixed-replace`) は `<img>` で描画。`<iframe>` は不可**
  （iframeはload eventが出ず、8秒ウォッチドッグが誤発火して軽量へフォールバックする）。
- **スナップのポーリングは onLoad駆動**（前フレーム読込完了後に次を取りに行く）。
  固定間隔(`setInterval`)だと、ルート応答が間隔より遅い時に**毎リクエストがキャンセル**され表示されない
  （snapshotルートは `getUser()`+Storage往復で>1秒かかる）。grid は5秒間隔で動いていた。
- **グリッド16分割は RTSP デコードではなく HTTPスナップ取得→`sharp`合成→1枚アップロード**
  （`edge-agent/src/modes/grid.ts`）。個別16枚送信より合成1枚が帯域/Storageリクエストで有利。

## 4. リモートカメラ視聴（Cloudflare Tunnel + Access）

- Frigateライブはローカル網限定（WebRTC=UDP）。リモートは **Cloudflare Tunnel(named) + MJPEG**。
  **WebRTCはUDPでトンネル不可**なので `live_host` にスキームありなら `/api/<cam>?fps=5&height=720`（MJPEG）を使う。
- 公開面は **Cloudflare Access**（Zero Trust team `ossvms-store01`、許可メールのみ）。
  **`CF_Authorization` cookie は SameSite=None** なので、別ドメイン(vercel.app)からの埋め込み`<img>`にも
  ログイン後は乗る。未認証は302→`<img>`失敗。**ワンクリック「カメラにログイン」導線**(`ImageStreamMode`)で解消。
- 固定URL `poc-beelink.genesis-edge.com`、systemd `cloudflared-intereco`（再起動自動復帰）。
- 多店舗スケールはトンネルでなく **SFU(LiveKit Cloud)** に集約する方針（decision済み）。

## 4.5 SFU(LiveKit)ライブ配信 — ベータで実機成立（2026-07-12・6段の落とし穴）

エッジ→LiveKit publish は「go2rtc の H.264 を WHIP で流す」。**PoC期のコードは無く新規実装**。
実機で順に踏んだ地雷（全部ログ根拠で潰した・再発防止）:

1. **ffmpeg に WHIP muxer 必須**。現地の johnvansickle 静的ビルドは **WHIP 非対応**（`output format 'whip' is not known`）。**BtbN の master ビルド**（`ffmpeg-master-latest-linux64-gpl`）に差し替える（`ffmpeg -muxers | grep whip` で確認）。エッジは PATH の `/usr/local/bin/ffmpeg` を spawn。
2. **RTMP Ingress は避ける**。johnvansickle の RTMP 実装は **SIGSEGV**（ファイル出力mp4/flvは通るのにRTMPネットワークだけ落ちる）。WHIP が正。
3. **WHIP は素通し（transcodeしない）→ profile 互換必須**。go2rtc ソースは `h264 High` で、`-c copy` だとブラウザが復号できず「配信待ち→黒画面」。**`-c:v libx264 -profile:v baseline -pix_fmt yuv420p`** に変換。（RTMP Ingress は逆に transcode するのでcopyでも良いが、上記2でRTMP不可）
4. **WHIP muxer の UDP 送信バッファ溢れ**（`UDP send blocked ... -ts_buffer_size` / `ret=-11`）。**`-ts_buffer_size 8000000`＋720pダウンスケール＋`-b:v/-maxrate/-bufsize`** でI-frameバースト縮小。
5. **切替時の即死**（`Immediate exit requested`）。軽量/高画質→SFU切替で**前モードのcleanupが~300ms後にstop_streamを予約(F75)**し、SFU起動直後のffmpegを殺す。**LiveKitMode も mount時に `cancelPendingStop(edgeId)`** を呼ぶ（他モードと同じ）。
6. **視聴者トークンの認可**（旧 `/api/livekit/token` は任意room/can_publish/identity を許可＝穴）。cameraId由来room・RLS可視性・canPublish=false・identity=user.id に是正。publish起点は monitor サーバ（`/api/livekit/publish` が Ingress発行＋`start_sfu` dispatch）＝エッジに鍵不要。

構成: monitor `/api/livekit/{token,publish}` + `lib/livekit-server.ts`（WHIP_INPUT Ingress）/ edge `modes/sfu-publish.ts`（go2rtc RTSP `cam_<id>` @ `:18554` → **h264_vaapi**（起動10秒以内失敗で libx264 へ自動フォールバック・sticky）→ whip-proxy → WHIP）。機能フラグ **`LIVEKIT_ENABLED='true'`**（既定OFF）。

ベータ完了後の運用形（2026-07-12・PR#148〜155）:

7. **OTA自己再起動は ffmpeg を道連れにする**（最重要の運用地雷）。旧agentが `process.exit(0)` すると
   アクティブモードの ffmpeg が cgroup に残存 → WHIP の ffmpeg は SIGTERM 後のセッション終了処理で
   **ハング** → systemd stop-sigterm 90秒タイムアウト → unit 'failed' → **OnFailure ロールバック誤発火**
   （新版は無実なのに `last_failed_version` cooldown 入り。復旧＝新しいSHAを desired に指定するだけ）。
   恒久対策: `ota/pre-restart.ts`（exit前に `fsm.toIdle()`・上限8秒）＋ SFU stop() の SIGTERM→3秒→SIGKILL。
8. **VAAPI**: `-hwaccel vaapi -hwaccel_output_format vaapi` + `scale_vaapi` + `h264_vaapi -profile:v
   constrained_baseline -bf 0`（**WebRTCはB-frame不可**・h264_vaapi既定はbf>0なので明示必須）。実機成立。
9. **低遅延**: 入力側 `-fflags +genpts+nobuffer -flags low_delay` でグラスtoグラス**約1秒**（旧トンネルMJPEG 2〜3秒）。
10. **コールドスタート短縮（キープウォーム）**: 視聴終了で即 stop せず **sfu-reaper cron**（5分毎・視聴者0
   ＝publisher(identity=edge_id)のみ→`stop_sfu`・生成120秒猶予）に委譲。publish start は配信中なら
   fast-path（`isPublishing` → subscribeのみ）、Ingress は同room再利用。さらに **GOP短縮 g=10**
   （WebRTC途中参加は次のキーフレームまで映像が出ない・WHIP muxer は PLI/FIR 非対応のため
   GOP=1秒間隔が効く・PR#157）で **再視聴 ~1秒（実測）**・
   初回コールドは ~9秒（ttff計測は transport タグ付きで `/infra/slo` に p50/p95 表示・目標は sfu≤15s/hls≤10s）。
11. **SFU は並行ワーカー**（キープウォーム成立の前提・PR#155）。エッジの状態機械は単一 active 設計の
   ため、当初 SFU を state='live' に載せたら **store画面へ戻った時の start_live/start_grid が
   キープウォーム中の SFU 配信を毎回置き換えて殺し**、再視聴が常にコールドだった（journalctl:
   start_live の1秒後に sfu ffmpeg exited）。対策: SFU を BCPワーカーと同じ**単一activeの外**へ
   （`fsm.startSfu/stopSfu`・grid/軽量/vod と共存・上り~2.5Mbps）。停止は専用 `stop_sfu` のみで
   `stop_stream` は SFU に触れない＝**F75「予約stop_streamがSFUを殺す」ハザードも構造的に解消**
   （LiveKitMode の cancelPendingStop は撤去済み）。start_sfu のスロット競合は
   dispatchStartSfu のリトライ（700ms×4）が吸収。

## 4.6 認証プロキシ越し HLS は「毎リクエスト認証」だと構造的に死ぬ（2026-07-12）

高画質(go2rtc HLS)を `/api/live-proxy/*` 経由にした構成は**導入時から遠隔で全滅**していた。
症状「高画質映像を表示できません」/ Vercelログ: `stream.m3u8`・`playlist`・`init`=200 なのに
**`segment.m4s` だけ 404**。ローカル直叩きは 200＝go2rtc は健全。

- 根因: go2rtc の HLS は**セグメント0.5秒刻み・ライブバッファ数秒**。proxy が毎リクエストで
  Supabase 認証（`getUser`+RLS照会 ≒1〜2秒）すると、セグメント要求が届く頃には**バッファから
  追い出されて 404** → hls.js 致命エラー。認証遅延がライブバッファ寿命を超えたら終わり。
- 対策（PR#159）: `stream.m3u8` だけフル認証し **HMAC署名クッキー**（camera・origin・exp 封入・
  TTL10分・`LIVE_SIGNING_SECRET` 流用・`Path=/api/live-proxy/<cameraId>` 限定）を発行。
  `api/hls/*` は**クッキー検証のみ（DB往復ゼロ）**。無効時はフル認証へフォールバック。
  純ロジック: `lib/live-proxy-session.ts`（テスト付）。
- 教訓: **短寿命リソース（ライブHLSセグメント）を認証プロキシに通すなら、認可は
  セッション開始点で1回だけ行い、以降は暗号学的トークンで通す**。診断は
  「ローカル直叩き→Vercelログのパス別ステータス→リクエスト間隔」の順が最短。
  `vercel logs <url> --json` はローカルCLIで本番ランタイムログを流し見できる。

### 4.6.1 高画質(HLS)不達の症状別切り分け（2026-07-17 追補）

「高画質が映らない」は Vercel ログのパターンで3系統に分かれる。上の segment 404 とは別に:

- **live-proxy へのリクエストが1件も無い** → クラウド/エッジ障害ではなく **hqUrl が null**。
  高画質(HLS)ボタンは `edge_devices.go2rtc_host` か `recorder_cameras.hls_url` が
  ある時だけ描画される（`live/page.tsx` の `hasGo2rtc`）。ボタン自体が消えて既定JPEGに
  落ちるので、利用者は「映らない」と表現する。→ /admin/edges で go2rtc_host を確認。
- **playlist も segment も全部 200 なのに真っ黒** → **go2rtc ストリーム定義が H.265 素通し**。
  go2rtc は素通し定義だと H.265 を fMP4 に平気で詰めて返し（HTTPは全部成功）、ブラウザが
  復号できず無音で真っ黒になる。確認: エッジで `curl -s localhost:1984/api/streams` →
  該当 `cam_<id>` の producer が `exec:...h264_vaapi...{output}` か素の `rtsp://` か。
  素通しなら `~/go2rtc.yaml` の該当行を VAAPI 変換 exec 定義（他カメラの行が雛形）に
  置換して `systemctl restart intereco-go2rtc`（2026-07-17 実障害: WV-SW158 だけ素通しで
  真っ黒、変換定義追加で復旧）。
- **stream.m3u8 が 404/502** → go2rtc に `cam_<カメラID>` の登録が無い（新カメラ追加時の
  登録漏れ）か go2rtc/トンネル停止。streams 一覧に無ければ go2rtc.yaml に1行追加。

モニタが要求するストリーム名は常に `cam_<recorder_cameras.id>`。go2rtc 側を cam101 等の
手動命名にすると UI から永遠に 404 になる点にも注意。

2026-07-17 の追加知見（同日の実障害の続き）:

- **go2rtc.yaml はエージェントが自動生成**（`edge-agent/src/go2rtc/sync.ts`・5分毎）。
  手動編集はかつて全消しされたが、70a1e612e 以降は**担当外の `cam_*` 行を保持して
  マージ生成**（PR#169）— 手動登録・複数エージェント同居OK。担当外行の掃除は手動。
- **MINI-S には2エージェントが同居**: `intereco-edge`（17f0cd0b・OTA対応・WV 2カメラ・
  店舗「PoC Beelink Store」）と `intereco-edge-demo`（28fee1ec・OTA非対応・Hview・
  店舗「デモ店(Frigate/Hview)」）。**OTAパネルで「現行 agent が −」の行は版を報告しない
  エッジ＝目標を入れても適用されない**（設定先を間違えた実例あり）。
- **Frigate 内蔵 go2rtc の RTSP(8554) はコンテナ内ポート**。ホストの go2rtc から
  `rtsp://127.0.0.1:8554/...` は Connection refused になる。frigate-demo は 8554 未公開
  のため**コンテナIP直（`rtsp://172.17.0.2:8554/hview_main`）**で接続。コンテナ再作成で
  IP が変わり得るので、恒久化は compose に `ports: "127.0.0.1:8556:8554"` を足す。
- トンネル ingress は `~/.cloudflared/config.yml`（`poc-beelink`→localhost:5000=Frigate UI／
  `go2rtc-poc`→localhost:1984=go2rtc）。**go2rtc_host に poc-beelink を入れると Frigate UI に
  プロキシされて高画質は不成立**（Hview がこの状態だった→ go2rtc-poc へ UPDATE で解消）。

## 5. Vercel monorepo（bun workspace）デプロイ

- リポジトリは home配下(`/Users/junji.y`)、remote `yoshihara6233/reception`。monitorは `claude/monitor`。
- Vercel: **Root Directory=`claude/monitor`**、**「Include files outside the root directory」ON**（`@intereco/shared` 解決のため）、
  本番ブランチ=`monitor-prod`。reception とは別プロジェクトで独立。
- ビルド検証は worktree `monitor-recover` で `bun install`(root) → `cd claude/monitor && bun run build`。
  `.next` のtmp ENOENTが出たら `rm -rf .next` で再ビルド。

## 6. admin_users の RLS は self-only → admin系の読みは service client で

`admin_users` に効いている **唯一の RLS SELECT ポリシーは `admin_users_self_select`
（`auth_user_id = auth.uid()`）の自己参照のみ**（reception由来の `tenant_id = get_tenant_id()` は
撤去済み。INSERT/UPDATE/DELETE ポリシーも無い）。確認は SQL:
`select policyname, cmd, qual from pg_policies where tablename='admin_users';`

- **RLS配下のセッションクライアント（`createSupabaseServer`）で `admin_users` を一覧/他人読みすると、
  ログイン中の自分の行しか返らない**。service client(RLSバイパス)で作成した他ユーザは必ず除外される
  → 「ユーザ追加できるのに一覧に出ない（自分だけ出る）」の典型症状（2026-06-13 修正）。
- **admin系の読みは `requireAdmin()`(ロール認可) → `createSupabaseService()`(RLSバイパス) → コードで
  role別フィルタ**（super_admin=全件 / tenant_admin=自テナント）。書き込み(POST/PUT/DELETE)は元々
  service client なので self-only RLS は INSERT/UPDATE 保護として温存できる。
  該当: `monitor/src/app/admin/users/page.tsx`, `.../users/[id]/page.tsx`。
- `get_tenant_id()` は JWT `app_metadata.tenant_id` を見るが、monitor は `createUser` 時にこれを
  セットしないため多くのアカウントで NULL。**テナント分離をJWTに依存しない**こと。
- 別件未調査: `new`/`edit` のテナント・店舗ピッカーも RLS セッション読み → 空表示の可能性あり。

## 6.5 パーティション表を PostgREST の埋め込みに使うと「0件」で素通りする（2026-08-10・本番で1度も動いていなかった）

PostgREST の埋め込み（`.select('id, stores!inner(tenant_id)')`）は**外部キーから相手を探す**。
**月次パーティション化した表は外部キーを失っている**（`live_sessions` は `live_sessions_pkey` と
`mode_check` しか持たず、remote_baseline にも無い）。相手が見つからないと PGRST200 → 400 だが、

```ts
const { count } = await svc.from('live_sessions')      // ← error を受け取っていない
  .select('id, stores!inner(tenant_id)', { count: 'exact', head: true })
const active = count ?? 0                              // ← null が 0 になる
if (active >= max) { /* 発動しない */ }
```

と書いてあると **`count` は null → 0 として素通りする**。同時視聴上限(F-10)がこれで、
**本番で一度も発動していなかった**。429 も metric(`session_rejected`) も出ないので、
ダッシュボード上は「上限に達していない」ようにしか見えない＝壊れているのに正常と区別が付かない。

- **上限・課金・認可の判定を埋め込みでやらない。** 素の SQL（DB 関数）で数える。
- 判定と INSERT は **1 トランザクションに畳む**。分けると数えてから入れるまでに隙ができ、
  同時に来た N 本が全員通る（advisory lock でテナント単位に直列化。`start_live_session()`）。
- 判定が失敗したら**フェイルクローズ**。`const { count } = ...` のように error を捨てない。
- 検査: `tests/schema-meta/embed-inventory.test.ts` が src の埋め込みを全部拾って
  外部キーの実在を確かめ、パーティション表の埋め込みを禁じる。
- 同時実行の契約: `tests/schema-meta/concurrency.test.ts`（DB）／`e2e/session-limit.spec.ts`（実サーバ）。
  スループット計測は `scripts/load-measure.mjs`（ローカル専用・本番に向けない）。

## 7. パスワードリセット（メールベース・allowlist回避）

ログイン画面 → `/forgot-password` → `POST /api/auth/reset-link` →
`supabase.auth.admin.generateLink({ type:'recovery' })` で生成したリンクを **Resend で本人にメール送信**
→ `/reset-password` で `verifyOtp({type:'recovery'})` → `updateUser({password})`。

- **OTP/action_link はブラウザに返さず、メールでのみ配送**（メール所持＝本人確認）。
  reception 版は OTP を直接URLに載せて遷移しており、メアドを知れば誰でも他人のPWを変更できる穴があった→踏襲しない。
- `admin.generateLink` を使うと **Supabase の Site URL / redirect allowlist を経由しない**（自前 `/reset-password` に飛ばせる）。
- 列挙対策で `/api/auth/reset-link` は送信可否を問わず汎用 `{ok:true}` を返す。
- 送信元は `no-reply@noreply.intareco.jp`（BCPと同じ検証済みドメイン `noreply.intareco.jp`）。`RESEND_API_KEY` 必須。

## 8. その他
- 作業worktree: `/Users/junji.y/claude/Intereco/monitor-recover`（ブランチ `monitor-prod`）。
- スマホ16分割は「合成画像の2×2象限ズーム＋透明タップ格子」で4分割＆単一ライブ遷移を実現（`MonitorWorkspace.tsx`）。
- 計画書一式は `docs/*.md`（WBS/スケール/意思決定/構成/config②機能）と spec `docs/recorder-monitoring-spec.html`(v6.0)。

## 9. デザイン基本（Genesis Edge）★UIを触る前に必読

**視覚はすべて Genesis Edge デザインシステムに従う。正本: `docs/GENESIS_EDGE_USAGE.md`。** 独自の色/フォント/余白を発明しない。
- 三色: 紙`#F7F5F1` × 墨`#0F0F10` × 藍`#2C4A7E`。**一画面で藍は2〜3まで・グラデ禁止**。成功`#2F7A4F`/警告`#B5761A`/危険`#A3332B`。
- タイポ: 本文 Noto Sans JP / 見出し Inter Tight / 数字 IBM Plex Mono(tabular)。角丸=ボタン4px/カード6px/モーダル10px。カードは影なし×1pxボーダー。**色付き左ボーダー強調・カード持ち上げhover は禁止**。
- アイコンは Lucide(1.5px・currentColor)、絵文字/装飾アイコン不可。ブランド「録画モニター」アイコン＝右下切り欠き＋藍ドット（現行ヘッダー/PWA `MonitorMark`・`public/icons/monitor-icon.svg` と同意匠）。
- 現状は Tailwind 実装で `--ge-*` 完全移行は未完。**新規/改修UIは本基本に合わせる**。藍`#2C4A7E`・紙`#F7F5F1` は整合済み。
