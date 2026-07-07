# intereco-live-gate — Frigate ライブの CF ログイン廃止（案2）デプロイ手順

Frigate のリモート MJPEG ライブを、カメラ側 Cloudflare Access の**ブラウザログイン無し**で見られるようにする。
monitor が短TTL HMAC 署名を付与し、この Worker が検証して Frigate へ通す。低遅延・認証維持。

```
[本部ブラウザ] --(monitorログインのみ)--> <img src="https://poc-beelink.../api/<cam>?fps=5&height=720&exp=..&sig=..">
        └ Cloudflare edge: [Access=Bypass] → [Worker: 署名検証] → tunnel → Frigate
[monitor サーバ] --(go2rtc HLS / service token)--> 同ホスト /api/* → [Worker: token検証] → 通す
```

## 前提
- 対象ホスト: `poc-beelink.genesis-edge.com`（zone `genesis-edge.com` が Cloudflare 管理下）
- `wrangler` CLI（`npm i -g wrangler` または `bunx wrangler`）でログイン済み（`wrangler login`）
- monitor 側 env（Vercel）に **同じ** `LIVE_SIGNING_SECRET` を設定できること

## 手順（順番厳守）

### 1. 署名鍵を生成（monitor と Worker で共有する1つの秘密）
```bash
openssl rand -hex 32   # 出力を控える（= LIVE_SIGNING_SECRET）
```

### 2. Vercel(monitor) に env を設定 → Redeploy
- `LIVE_SIGNING_SECRET` = 手順1の値（Production/Preview）
- （任意）`LIVE_SIGN_TTL_SEC` = `7200`（既定2h。テナントの視聴時間上限より長くすること）
- 設定後 **Redeploy**。まだ Worker 未デプロイなので、この時点で署名URLが出るが Frigate 側 Access は
  従来どおり → ブラウザは今まで通り「カメラにログイン」動線でも見られる（無停止移行）。

> 補足: env 未設定なら monitor は署名せず従来の生URL（CFログイン方式）にフォールバックするため、
> 手順を途中で止めても壊れない。

### 3. Worker をデプロイ
```bash
cd claude/cloudflare/live-gate
wrangler secret put LIVE_SIGNING_SECRET          # 手順1の値
wrangler secret put SERVICE_TOKEN_CLIENT_ID      # = Vercel GO2RTC_CF_ACCESS_CLIENT_ID
wrangler secret put SERVICE_TOKEN_CLIENT_SECRET  # = Vercel GO2RTC_CF_ACCESS_CLIENT_SECRET
wrangler deploy
```
`SERVICE_TOKEN_*` は go2rtc HLS プロキシ(サーバ側)を通すために必要（Access を Bypass にするため、
service token 検証を Worker が肩代わりする）。値は Vercel の既存 `GO2RTC_CF_ACCESS_CLIENT_ID/SECRET` と同一。

### 4. Cloudflare Access を該当パスだけ Bypass にする
Zero Trust ダッシュボード → Access → Applications:
- 既存アプリ（`poc-beelink.genesis-edge.com` を保護）はそのまま**残す**（Frigate UI 等の他パス保護のため）。
- **新規アプリ**を追加: Application domain = `poc-beelink.genesis-edge.com` / **Path = `api`**（`/api/*`）。
  - Policy: **Action = Bypass** / Include = **Everyone**。
  - これで `/api/*` は Access のログインを求めず、Worker が唯一のゲートになる。
- ※ アプリの評価順で「より具体的なパス(api)」が優先される。VOD 用 `/vod/*` は対象外のまま。

### 5. 検証
1. **署名ブラウザ視聴**: monitor にログイン → 対象カメラの単一ライブ → 高画質(NVR直接/MJPEG)。
   Cloudflare のログイン画面が**出ずに**映れば成功。DevTools Network で `/api/<cam>?...&exp=..&sig=..` が 200。
2. **署名なし拒否**: `exp/sig` を除いた URL を直叩き → **403**（Worker が弾く）。
3. **go2rtc 高画質(HLSプロキシ)が従来通り**再生できる（service token 経路が壊れていない）。
4. **VOD-HLS**（録画再生）が従来通り（`/vod/*` は無影響）。

### ロールバック
- Worker: `wrangler delete`（または route を外す）。
- Access: 手順4で作った Bypass アプリを削除 → `/api/*` が再び Access ログイン必須に戻る。
- monitor: Vercel の `LIVE_SIGNING_SECRET` を削除 → Redeploy で生URL(CFログイン方式)に自動フォールバック。
- どの単独ロールバックでも「見られなくなる」だけで、認証が緩むことはない（fail-closed）。

## セキュリティ設計メモ
- 署名は `HMAC-SHA256(secret, "<pathname>\n<exp>")` の hex。カメラは pathname に含まれ**別カメラ流用不可**。
- TTL は既定2h（bearer 的だが短TTL）。接続断後の再接続で TTL を跨いだら monitor が `/api/live-sign/<cam>` で
  署名を取り直す（RLS 可視性を再確認して再発行）。
- Access Bypass は `/api/*` のみ。Worker は「service token 一致」か「署名一致」以外はすべて 403（fail-closed）。
- 鍵ローテ: 手順1で新鍵→ Vercel env 更新+Redeploy → `wrangler secret put` で更新 → `wrangler deploy`。
  monitor と Worker の鍵が一致している瞬間だけ有効。無停止にしたい場合は旧新2鍵受理を一時実装する。
