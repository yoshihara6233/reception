# Intereco 引き継ぎサマリー（次回セッション用）

最終更新: 2026-06-13 / このファイルを次回セッション冒頭にコンテキストへ投入すれば状況を即把握できる。

## 0. 一行サマリー
Intereco Recorder Monitor を**本番公開済み**（`https://intereco-monitor.vercel.app`）。実機PoC1台で
ローカル/リモート両対応・認証付き・再起動耐性ありで稼働。今は**開発計画フェーズ**で、量産・スケール・
ベンダ統合の WBS と意思決定を固めた段階。

## 1. 作業環境
- **作業worktree**: `/Users/junji.y/claude/Intereco/monitor-recover`（ブランチ **`monitor-prod`**、remote `yoshihara6233/reception`）。
  ※元の `.claude/worktrees/distracted-mcnulty-075bcd` はビルド中に壊れ、`monitor-recover` に復元した。
- **構成**: `claude/monitor`(Next.js, Vercel) / `claude/edge-agent`(Bun, 現地) / `packages/shared`。
- **本番**: Vercel project `intereco-monitor`（reception と独立・自動デプロイ on `monitor-prod`）。

## 2. 本番の現状（稼働中）
ログイン / 地図 / 店舗 / 16分割グリッド / 軽量ライブ / **リモート高画質(Cloudflare Tunnel+MJPEG+Access)** /
BCP / 警備 / infra / レポート / 管理。実機 Beelink（systemd `intereco-edge` + `cloudflared-intereco` + Frigate Docker）、
サーバ再起動で全自動復帰を確認済み。

- Supabase 本番: `jmlviywilxzavjbmlpnf`（**新APIキー形式**・全25マイグレーション適用済み）。
- リモート高画質: 固定URL `poc-beelink.genesis-edge.com`、Cloudflare Access（許可メール `yoshihara8238@gmail.com`）。

## 3. 確定した計画（docs/ に詳細）
| ドキュメント | 内容 |
|---|---|
| `wbs-dev-test-plan.md` | WBS全体・テスト計画（3〜5名・品質優先） |
| `scale-plan-quantified.md` | 実数スケール（2026/11 1店→2027/06 5000店・同時最大300・上り10Mbps・保持31日） |
| `decision-sfu-and-edge.md` | **SFU=LiveKit Cloud で開始（承認済）**・エッジHW判断 |
| `edge-configs-and-relay-hardware.md` | **拠点構成3種**・中継ユニットHW(N100級1SKU)・代理店設定 |
| `wbs-config2-features.md` | ベンダ統合/マルチグリッド16-32-48/ティア課金 のWBS(~60人日) |
| `recorder-monitoring-spec.html` | 仕様書 **v6.0**（上記を要約反映） |

**主要決定:**
- 拠点構成3種：①本部直結VPN(VGAスナップ壁10秒/16ch~0.5Mbps) / **②既存NVR+中継ユニット(本命)** / ③Frigate(録画・稀)。
- 高画質配信は **LiveKit Cloud(SFU)**。店舗ごとトンネルは1店PoC限り、100店以降SFU集約。
- カメラ数 **16/32/48 の3ティア**＝マルチグリッド（16グループのページ複数・アクティブグループのみ合成で負荷有界）。
- 課金は **1ハードをソフトのティア(`edge_devices.camera_tier`)で区別**、ユニット別切替。
- 中継ユニット **1SKU**（Intel N100級ファンレス・8-16GB・64-128GB・2NIC・¥1.5-3万）。代理店が承認機種調達 or 事前イメージ品＋QR初回登録＋ONVIF自動探索。

## 4. 次のタスク（優先順）
### 最優先（M-Nov 1店 本番品質 / M-Dec 100店 の前提）
1. **A. ベンダ統合**（config②の核・現状ギャップ大）:
   - グリッドスナップを Uniview/i-PRO 対応（現状 `snapshotUrl()` がFrigateのみ・他はnull）
   - **VODアダプタ統合**（現状Frigate専用・**i-PRO ONVIF Profile-G**含む）
   - **Univiewアダプタ作成**（アダプタ枠に未統合・legacyのみ）
   - 3社実機検証（grid/live/vod/bcp）
2. **基盤(M0)**: CI(typecheck/lint/build/test)・**エッジ/トンネル死活監視＋アラート**・環境分離(dev/staging/prod)。
3. **鍵運用の同期自動化**（ローテ時 monitor+edge を無停止更新。本日の事故対策）。

### 中期
4. マルチグリッド 16/32/48 実装（grid_pos 0-47・グループ合成・グループタブUI・admin割当）。
5. ユニット別ティア課金（DB・強制・切替UI・課金集計レポート）。
6. SFU(LiveKit Cloud) ベータ→本番（既存 `livekit-server-sdk`/WHIP流用）。
7. エッジ量産（ゴールデンイメージ+QR初回登録+ONVIF探索ウィザード）・N100で48ch実機検証。
8. セッション上限(120分)・Vault化・VOD UX。

## 5. 未確定（次に詰める入力）
- ①のVPN到達手段（ポート開放/VPN/P2P）と①の許容カメラ数。
- NVR対象機種（Uniview/i-PRO 具体）。代理店モデル（承認機種 or 事前イメージ供給）。
- ティア粒度（camera_tier単純列 or plan表）・課金サイクル・SLO目標値・サポート体制・予算枠。
- BCP「発災時刻ちょうどの1枚」要件（Univiewは過去スナップ非対応→replay抽出fetcher追加の要否）。

## 6. セキュリティ宿題（要対応）
- **service_role secret 鍵** と **ログインパスワード `Intereco2026`** が前セッションのチャットに残存。
  → 鍵は再ローテ推奨（Supabase API Keys で再生成→Vercel `SUPABASE_SERVICE_ROLE_KEY` と**エッジ.env両方更新**）。
- gstack 更新あり（1.52.1.0→1.58.0.0、任意）。

## 7. 知見(Skill化済み)
`.claude/skills/intereco-patterns/SKILL.md` に主要な落とし穴を集約（Supabase新キー+apikeyヘッダ、鍵ローテ×edge同期、
MJPEGは`<img>`+onLoad駆動、Cloudflare Tunnel+Access、Vercel monorepoデプロイ、グリッド=スナップ合成）。
AIメモリ `intereco-monitor-deploy` にも要点を記録済み。
