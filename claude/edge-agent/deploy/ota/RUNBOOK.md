# エッジ自律OTA 適用手順 + known-good ロールバック手順（Beelink PoC機）

対象: `intereco-edge`（Bun・user `intereco`）+ `cloudflared-intereco`。設計は `docs/edge-ota-design.md`。
前提: 本番DBに migration `20260630_002_edge_ota.sql` を**先に**適用（列が無いと heartbeat の版報告が失敗する）。

> ⚠ `EDGE_ROOT` を設定するまで OTA は完全に no-op。レイアウト移行と migration が済むまで
> `agent.env` に `EDGE_ROOT` を**書かない**こと（既存挙動のまま安全）。

## A. 一度きりのセットアップ（実機 SSH）

```bash
# 0) 事前: 本番DBに 20260630_002_edge_ota.sql を適用（SQL Editor / supabase db push）

# 1) コードを最新化（既存チェックアウト）
cd /home/intereco/intereco && git fetch origin monitor-prod && git checkout monitor-prod && git pull

# 2) リリースディレクトリ・レイアウトを作る（現行コミットを sha0 として封入）
SRC=/home/intereco/intereco EDGE_ROOT=/home/intereco/edge \
  bash /home/intereco/intereco/claude/edge-agent/deploy/ota/bin/setup-layout.sh

# 3) agent.env に OTA 設定を追記（EDGE_ROOT を入れて初めて OTA 有効化）
cat >> /home/intereco/edge/shared/agent.env <<'ENV'
EDGE_ROOT=/home/intereco/edge
EDGE_AGENT_UNIT=intereco-edge
CLOUDFLARED_UNIT=cloudflared-intereco
ENV

# 4) sudoers（限定 NOPASSWD）。visudo -c で検証してから配置
sudo install -m0440 -o root -g root \
  /home/intereco/intereco/claude/edge-agent/deploy/ota/sudoers-intereco-ota \
  /etc/sudoers.d/intereco-ota
sudo visudo -c

# 5) systemd ユニット差替（OTA レイアウト版 + 層2ロールバック）
sudo cp /home/intereco/intereco/claude/edge-agent/deploy/ota/intereco-edge.service          /etc/systemd/system/intereco-edge.service
sudo cp /home/intereco/intereco/claude/edge-agent/deploy/ota/intereco-edge-rollback.service  /etc/systemd/system/intereco-edge-rollback.service
sudo systemctl daemon-reload
sudo systemctl restart intereco-edge
sudo systemctl status intereco-edge   # current(=sha0) で起動を確認
```

確認: monitor の対象エッジ行で `agent_version` が sha0、`ota_status=idle`/`healthy` になること。

## B. 通常の更新（クラウド宣言＝無人OTA）

1. monitor で対象エッジ1台（**カナリア**）に desired を設定:
   - 暫定: `PUT /api/admin/edges/<id>` body `{"desired_agent_version":"<short sha>"}`（管理者）
     または SQL: `update edge_devices set desired_agent_version='<sha>' where id='<id>';`
2. 5分以内（`BOOTSTRAP_INTERVAL_MS`）にエッジが pull → 自己更新 → 再起動 → 健全性プローブ。
3. 成功で `agent_version=<sha>` / `ota_status=healthy`。known-good も `<sha>` に更新される。
4. カナリアが healthy を確認できたら、残りの端末に同じ `<sha>` を設定（段階展開）。

> desired を**変えない限り**再更新は起きない（冪等）。ロールバック済みの版を desired のまま
> 残しても、`cooldown_failed_version` で再突入しない（desired を別 sha に変えるまで待つ）。

## C. ロールバック手順（known-good 復帰）

### C-1 自動（設計上の既定）
- **層1（起動はするが不健全）**: 新版が heartbeat をクラウドへ届けられない/不安定 →
  agent の `verifyOnBoot` が known-good へ current を戻して再起動（`ota_status=rolled_back`）。
- **層2（起動すらしない/クラッシュループ）**: 120秒に4回落ちると systemd が
  `intereco-edge-rollback.service` を発火 → `rollback-edge.sh` が current→known-good に戻し、
  ota-state を整合して再起動。**agent が一切動けなくても復帰する。**

### C-2 手動（即時に戻したいとき）
```bash
EDGE_ROOT=/home/intereco/edge bash /home/intereco/edge/bin/rollback-edge.sh manual
sudo systemctl status intereco-edge
```
- desired が悪い版のままだと次の pull で再更新されるので、**先に desired を戻す**:
  `update edge_devices set desired_agent_version='<known-good sha>' where id='<id>';`

### C-3 cloudflared
```bash
EDGE_ROOT=/home/intereco/edge bash /home/intereco/edge/bin/update-cloudflared.sh <version>
# 失敗時はスクリプトが前バイナリへ自動復帰。手動戻しは current symlink を前ターゲットへ。
```

## D. 受け入れ（実機ドライラン）
1. **正常更新**: 軽微変更コミット `<sha1>` を desired に → 自動更新 → `agent_version=<sha1>`, `healthy`。
2. **層1ロールバック**: 起動はするが heartbeat を出さない版（例: テスト用に heartbeat 送信を
   無効化したブランチ）を desired に → クラウド未到達のまま 90秒経過 → known-good 復帰、`rolled_back`。
   （`agent.env` は release 共有なので、URL/鍵の差し替えでは再現できない点に注意。）
3. **層2ロールバック**: boot 即時 throw する版を desired に → クラッシュループ →
   systemd OnFailure で known-good 復帰。
4. **cloudflared**: 版切替とロールバックを C-3 で確認。
5. 各段で `journalctl -u intereco-edge -f` と monitor の `ota_status` を観察。

## E. 落とし穴
- `EDGE_ROOT` 未設定 = OTA 無効（heartbeat に版を載せない）。移行前は安全に旧挙動。
- `agent.env` は release の外（`shared/`）。release ディレクトリに機密を置かない。
- migration 未適用のまま `EDGE_ROOT` を設定すると heartbeat の版報告で「列不明」エラー → 必ず先に migration。
- known-good は「healthy 実績のある版」。setup 直後は sha0 が known-good 兼 current。
