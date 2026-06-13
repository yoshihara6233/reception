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

本番プロジェクト `jmlviywilxzavjbmlpnf` は **レガシーJWTキー(anon/service_role)を無効化**済み。新形式
`sb_publishable_…`（=anon相当）/ `sb_secret_…`（=service_role相当）を使う。

- **raw `fetch()` で Storage を叩く時は `apikey` ヘッダが必須**。`Authorization: Bearer <key>` だけだと
  **502**（旧JWTはBearerだけで通っていた）。JS SDK(`@supabase/supabase-js`)は両方送るので問題なし。
  ```ts
  headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  ```
  該当: `monitor/src/app/api/edges/[id]/grid/route.ts`, `.../cam/[cameraId]/snapshot/route.ts`。
- **env名**: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`(=publishable) / `SUPABASE_SERVICE_ROLE_KEY`(=secret)。
- `live_host` 等はadmin UIに編集欄が無い → **Supabase SQL Editor で直接UPDATE**。

## 2. service_role 鍵ローテはエッジ.envも同期（でないと全停止）

鍵をローテ（旧失効）したら **エッジの `.env`（`/home/intereco/intereco/claude/edge-agent/.env` の
`SUPABASE_SERVICE_ROLE_KEY`）も新キーに更新 → `sudo systemctl restart intereco-edge`**。
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
