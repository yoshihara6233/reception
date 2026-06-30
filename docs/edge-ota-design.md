# エッジ自律OTA + known-good ロールバック 設計（Phase C）

対象: `claude/edge-agent`（Bun・systemd `intereco-edge`）+ `cloudflared-intereco`。本番ブランチ `monitor-prod`。
方針: **2（クラウド宣言駆動の自律OTA）**。1（リリース配置+symlink+健全性プローブ+自動復帰）の機構を内包し、その上に「クラウドが desired 版を宣言 → エッジが pull で差分検知 → 自己更新 → 自動ロールバック」を載せる。

## 0. 設計原則
- **唯一の現場を落とさない**: 悪い版でも自動で known-good へ戻る。二段ロールバック（agent健全性 + systemd OnFailure）。
- **per-device desired = カナリア**: desired版は端末ごと。1台に当てて健全を確認 → 残りへ promote。一括自爆を構造的に防ぐ。
- **既存チャネル再利用**: `/api/edge/bootstrap`（device_token pull・既存の鍵同期ループ）に desired版を相乗り。版報告は heartbeat に相乗り。新規エンドポイント最小。
- **軽量**: アーティファクトレジストリ/コンテナ無し。git fetch をソースに、symlink で原子的切替。

## 1. on-box レイアウト
```
/home/intereco/edge/
  repo/                      # git clone（monitor-prod を fetch する作業リポジトリ）
  releases/
    <shortsha>/              # repo を <sha> で checkout した worktree（+ bun install 済 node_modules）
      VERSION                # = <shortsha>（版の真実。heartbeat で報告）
  current      -> releases/<active>      # systemd が実行する版
  known-good   -> releases/<last_healthy># ロールバック先（健全実績のある版）
  shared/
    agent.env                # 機密。releases の外。各 release から symlink
    ota-state.json           # OTA状態（再起動を跨ぐ）
  bin/
    update-edge.sh rollback-edge.sh update-cloudflared.sh
```
- systemd: `WorkingDirectory=/home/intereco/edge/current` / `ExecStart=/home/intereco/.bun/bin/bun run src/index.ts`。
- 版 = git short SHA（`releases/<sha>/VERSION` に焼く）。クラウドはこの SHA（または tag）を desired として宣言。

## 2. 制御フロー（自律OTA）
```
[admin UI] desired_agent_version = <sha> を端末に設定（まずカナリア1台）
      │
      ▼ /api/edge/bootstrap 応答に desired_* を追加（既存pull・既定5分間隔）
[edge] supabase.ts の bootstrap ループが desired を受信
      │  desired != 現行VERSION なら self-update 起動（多重起動ガード）
      ▼
  update-edge.sh <sha>:
   1. repo を git fetch && releases/<sha> へ checkout（worktree）
   2. shared/agent.env を symlink、bun install --frozen-lockfile
   3. プリフライト: bun run typecheck（最低限コンパイル/型OK）
   4. ota-state.json に pending_verify=<sha>, prev_good=<known-good>
   5. current -> releases/<sha> に切替、sudo systemctl restart intereco-edge
      ▼ 再起動後（新版で起動）
[edge boot] ota-state に pending_verify があれば健全性プローブ:
   - クラウドへ heartbeat が N秒以内に到達（version=<sha> 付き）
   - プロセスが M秒(既定90s)継続して安定
   合格 → known-good を <sha> に更新、pending_verify クリア、ota_status=healthy 報告
   不合格 → rollback-edge.sh（current -> known-good に戻し restart、ota_status=rolled_back）
```

## 3. 二段ロールバック（安全の核）
- **層1: agent 健全性プローブ（起動はするが不健全）** — 上記。新版が起動して heartbeat も出すが、クラウド到達不可/不安定なら agent 自身が known-good へ戻す。
- **層2: systemd OnFailure（起動すらしない/クラッシュループ）** — `intereco-edge.service` に
  `StartLimitIntervalSec=120 / StartLimitBurst=4` と drop-in `OnFailure=intereco-edge-rollback.service`。
  新版が DOA でクラッシュ連発 → systemd が `intereco-edge-rollback.service`（oneshot）を発火 →
  `current -> known-good` に戻して restart。agent が一切動けなくても復帰する。
- 状態は `shared/ota-state.json`（再起動耐性）。`attempts` を持ち、ロールバック後は desired を無視するクールダウン（同一 desired への再突入を防ぐ）。

## 4. 版報告（heartbeat 相乗り）
`heartbeat()` の update に追加: `agent_version`（releases/current/VERSION を読む）, `cloudflared_version`, `ota_status`（idle/updating/pending_verify/healthy/rolled_back）, `ota_updated_at`。
→ admin で「現行版 vs desired・最終OTA結果」を端末ごとに可視化。

## 5. 段階展開（カナリア → 全台）
- desired は **per-device**。admin は (a) カナリア端末に desired をセット → (b) `agent_version == desired && ota_status == healthy` を確認 → (c)「全台へ promote」で残りに一括セット。
- ガード: 「promote 全台」は確認モーダル。さらにクラウド側で「直近に healthy 実績のある版のみ promote 可」を強制（未検証版の一括配布を構造的に禁止）。

## 6. cloudflared
- `desired_cloudflared_version` を宣言。`update-cloudflared.sh <ver>`:
  ピン留めバイナリを `releases` 同様に取得 → `cloudflared` symlink 切替 → `sudo systemctl restart cloudflared-intereco` → 健全性（トンネル接続確立を確認）→ 失敗で前バイナリへ戻す。
- 既定は agent と独立に更新可（巻き戻しも独立）。cloudflared 自前 auto-update は無効化し、制御下に置く。

## 7. 権限（systemd ハードニング下）
- agent は `intereco` ユーザ。自分のユニット再起動のため **sudoers NOPASSWD** を限定付与:
  `intereco ALL=(root) NOPASSWD: /usr/bin/systemctl restart intereco-edge, /usr/bin/systemctl restart cloudflared-intereco`。
- symlink/ファイル操作は `intereco` が所有する `/home/intereco/edge/` 配下のみ。`/opt` 等の特権パスは使わない。

## 8. データモデル（追加列・edge_devices）
```
agent_version          text   -- 既存。エッジが報告する現行版
cloudflared_version    text   -- 新規。報告
desired_agent_version  text   -- 新規。クラウド宣言（NULL=更新指示なし）
desired_cloudflared_version text -- 新規
ota_status             text   -- 新規 idle|updating|pending_verify|healthy|rolled_back
ota_updated_at         timestamptz -- 新規
ota_last_error         text   -- 新規（ロールバック理由など）
```
RLS は既存方針踏襲（admin系は service / 端末は scoped）。authz 契約テストに新列の可視性影響が無いこと（列追加のみ）を確認。

## 9. 受け入れ（実機 OTA ドライラン）
1. Beelink に新レイアウトを適用（runbook）。現行コードを releases/<sha0> として current/known-good に。
2. admin で desired = <sha1>（軽微変更）に設定 → 5分以内に自動更新 → agent_version=<sha1>, ota_status=healthy。
3. **わざと壊れた版** <sha-bad> を desired に → 起動するが不健全 → 層1で known-good 復帰（ota_status=rolled_back）。
4. **DOA版**（boot で即落ち）→ 層2(systemd OnFailure) で known-good 復帰。
5. cloudflared 版切替とロールバックを同様に確認。

## 10. 実装順
1. エッジ self-update コア（純ロジック: 版比較・状態遷移・健全性判定・promote/rollback決定）+ vitest。
2. 版報告（heartbeat）+ bootstrap desired 受信 + boot 健全性フック。
3. クラウド: migration + bootstrap 応答 + admin UI（per-device desired・promote・可視化）。
4. systemd units / scripts / sudoers / cloudflared / runbook。
5. 実機ドライラン（受け入れ）。
