# 作業記録 — 2026-06-13

Intereco Recorder Monitor を本番公開し、実機PoC（Beelink + Frigate）でローカル/リモート両対応・認証付き・再起動耐性ありの稼働状態まで到達した日のログ。

本番URL: **https://intereco-monitor.vercel.app**

---

## 1. 復旧と本番公開

- ビルド中に消失した git worktree から復旧（F111まで無傷）。復旧用worktree `monitor-recover`（ブランチ `claude/distracted-mcnulty-075bcd`）で作業継続。
- 本番ブランチ **`monitor-prod`** を作成・push。
- Vercel に **別プロジェクト `intereco-monitor`** を作成（reception とは独立）。
  - Root Directory `claude/monitor`、Include files outside root = ON（bun workspace 解決）。
  - Production Branch = `monitor-prod`、GitHub連携で自動デプロイ。
- 初回本番デプロイ成功。reception 本番には一切影響なし。

## 2. Supabase 設定の誤り修正

- env が **削除済みプロジェクト `osjnqubtghzkejypjdis`** を指していた（停止した reception からコピーした古い値）。
- 実プロジェクトは **`jmlviywilxzavjbmlpnf`**。**レガシーJWTキーは無効化**済みで、新形式キー（`sb_publishable_…` / `sb_secret_…`）が必要。
- monitor 用マイグレーション **全25テーブルが適用済み**であることを検証。
- env 3点を正しい値に差し替え（URL・publishable は CLI、secret はダッシュボード）。

## 3. ログイン復旧

- `yoshihara8238@gmail.com` は存在（パスワード失念）。Admin API でパスワードを `Intereco2026` に直接設定。
- `admin_users` 行（role=super_admin、auth_user_id 紐付け）を確認。ログイン成功。

## 4. service_role キーのローテーション

- チャットに漏れた旧 secret キーを新キー（`monitor_prod_202606`）に置換 → Vercel更新・再デプロイ → 旧キー失効を確認（401）。

## 5. エッジ機（Beelink）復旧

- ログに `Unregistered API key`：エッジ `.env` が**ローテーションで失効した旧キー**を使用していた。
- `/home/intereco/intereco/claude/edge-agent/.env` の `SUPABASE_SERVICE_ROLE_KEY` を新キーに更新 → `sudo systemctl restart intereco-edge` → heartbeat 復活。

## 6. バグ修正

- **Storage 取得に `apikey` ヘッダ追加**（新形式キーは Bearer のみだと502）→ 16分割グリッド／カメラsnapshot の502を解消。
- **軽量ライブを onLoad駆動ポーリング化**（固定1秒間隔だと毎リクエストがキャンセルされ表示されなかった）。

## 7. リモート高画質ライブ（Cloudflare Tunnel）

- Frigate ライブはローカル網限定（WebRTC=UDP）。方式比較（Tunnel / Tailscale / クラウドリレー）の上、PoCは **Cloudflare Tunnel** を採用。
- named tunnel **`intereco-poc`** → 固定URL **`https://poc-beelink.genesis-edge.com`**（→ Frigate localhost:5000）。
- **リモートは MJPEG**（`/api/<cam>?fps=5&height=720`）を使用（WebRTCはトンネル不可）。`<img>` で描画（iframeだと load event が出ず軽量へ誤フォールバック）。
- **systemd 常駐** `cloudflared-intereco`。再起動自動復帰を確認（tunnel/edge/docker/frigate すべて enabled・frigate=unless-stopped）。
- **Cloudflare Access 認証**（Zero Trust team `ossvms-store01`、許可メールのみ）。未認証は302でブロック。`CF_Authorization` は SameSite=None で埋め込み`<img>`にも有効。
- 初回ログインの手間を **画面内「📹カメラにログイン」ワンクリック導線**に圧縮（独自ドメイン移行案は副作用大のため不採用）。

## 8. UI改善（5件）

1. 店舗ツリーのスクロール位置を sessionStorage で保持。
2. スマホ下部ナビを「モニタリング＋地図」に限定（BCP・設定を除外）。
3. 店舗情報パネルの表示/非表示トグル（`ShellBody`、localStorage保持）。
4. デッドリンク `/admin/recorders` をナビから除去、統計カードを `/admin/edges` へ。
5. スマホの監視を**実4分割（合成画像の象限ズーム）＋タップで単一ライブ**に修正。

---

## 現在の到達点

ログイン / 地図 / 店舗 / 16分割グリッド / 軽量ライブ / **リモート高画質（Tunnel+MJPEG+Access）** / BCP / 警備 / infra / レポート / 管理 — すべて本番稼働。PoC実機1台（Beelink + H.VIEW 1カメラ）で再起動耐性あり。

詳細な構成・キー・ハマりどころは AI メモリ `intereco-monitor-deploy` に記録。

---

## 今後の計画

### A. 直近（運用の足固め）
- **トンネル/エッジのヘルス監視＋アラート**（infra/ の死活監視に Beelink・cloudflared を組込み、落ちたら通知）。
- **MJPEG 画質/帯域チューニング**（fps・解像度、回線状況に応じた自動切替）。
- 必要なら **レコーダ専用管理ページ**（一覧・live_host 編集 UI。今は SQL 直編集）。

### B. 中期（機能拡充・残タスク）
- **セッション上限の強制**（1日120分。`daily_session_minutes` を使った制御 — 旧Phase 9）。
- **i-PRO NVR の ONVIF Profile-G**（録画再生。`src/onvif/` 新設 — 旧Phase 8）。
- **認証情報の Vault 化**（`recorders.password_enc` の本物の復号 — 現状プレーンテキスト前提）。
- 監視自動化（カナリアOTA、journald→クラウドログ転送）。

### C. 戦略（多店舗スケール）
- **店舗増設の方式決定**：
  - 数〜数十店：Cloudflare Tunnel の **named tunnel 自動化**（スクリプトで tunnel作成→DNS→Access→live_host 登録）。
  - 数百〜10,000店：**クラウドリレー（SFU）への移行**（エッジが配信をクラウドへ publish、視聴者は subscribe。店舗 inbound 開放ゼロ・NAT越えはクラウド・1配信→N視聴）。オンデマンド配信で「同時視聴数」課金に。
- **コスト試算**（LiveKit Cloud vs 自前SFU の損益分岐、店舗回線の上り帯域前提）。
- **認証統合/SSO**（monitor とカメラを同一IdP配下に。本格運用時）。

### 推奨ロードマップ
```
今     : A（監視・チューニング）で PoC を安定運用
次     : 2台目の店舗を A方式（named tunnel自動化）で追加し横展開を検証
本番化 : 規模が見えた段階で C（クラウドリレー）の設計・コスト確定 → 移行
並行   : B の残タスク（セッション上限・ONVIF・Vault）を優先度順に
```
