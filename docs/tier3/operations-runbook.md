# Tier 3 運用ランブック (F51.X)

> Phase 4 で本番運用を引き継ぐ際の手順書 雛形。
> Phase 1〜3 の実装内容に基づき、想定される運用シナリオごとに対応手順をまとめる。
>
> **改訂方針**: 実運用で発生した事象は必ずポストモーテムを書き、本ドキュメントに反映する。

## 目次

- [日常運用](#日常運用)
- [障害対応](#障害対応)
  - [AllNodesDown — 全ノード障害](#all-nodes-down)
  - [HalfNodesDown — 片系障害](#half-nodes-down)
  - [HeartbeatSuccessRateLow — 死活成功率低下](#heartbeat-failure)
  - [CommandSuccessRateLow — コマンド失敗多発](#command-failure)
  - [ManyCircuitsOpen — 大量サーキット OPEN](#circuit-breaker)
- [計画作業](#計画作業)
  - [新規店舗の追加](#新規店舗の追加)
  - [NVR 機種の追加](#nvr-機種の追加)
  - [中央ノードの追加](#中央ノードの追加)
  - [中央ノードの削除/メンテ](#中央ノードのメンテナンス)
  - [モード切替 (per_store_minipc ↔ central_aggregator)](#モード切替)
- [リリース手順](#リリース手順)
- [災害復旧](#災害復旧)
- [連絡先](#連絡先)

---

## 日常運用

### 月次タスク (第 1 営業日)

- [ ] `/infra/slo` で先月の SLO 達成状況を確認
- [ ] エラーバジェット消費が 50% 超なら振り返り会を設定
- [ ] `nvr_models` の EOL/EOS 情報を i-PRO 公式サイトと突合
- [ ] 中央ノードのリソース使用量推移 (Grafana) で容量計画
- [ ] ライフサイクル `urgent` 店舗の置換計画状況を顧客と確認

### 週次タスク (月曜午前)

- [ ] Slack #intereco-alerts の前週ログを確認
- [ ] `/infra/incidents` で未解決インシデント残数を確認
- [ ] `/admin/nvr-models` で最新 FW Ver の反映漏れがないか確認

### 日次タスク (営業時間内 任意)

- [ ] `/infra` ダッシュボード目視確認 (異常スパイクなし)
- [ ] `/infra/nodes` で全ノード `active` を確認
- [ ] Grafana Overview ダッシュボードで前日比異常なし

---

## 障害対応

### 一般原則

1. **アラート確認**: Alertmanager → Slack/PagerDuty 通知の `summary` と `runbook` URL
2. **影響範囲特定**: Grafana → `/infra/nodes` → 個別店舗確認の順
3. **暫定対応**: 本ランブックの該当セクションを実行
4. **根本原因調査**: Loki でログ確認 (`{service="edge-agent"} |~ "ERROR"`)
5. **ポストモーテム**: 24 時間以内に記録、ランブックに反映

### <a id="all-nodes-down"></a> AllNodesDown — 全ノード障害

**症状**: PagerDuty 緊急通知 / `/infra/nodes` で全ノード `down` / `/metrics` 全滅

**即時対応 (10 分以内)**

1. **電源・ネットワーク確認**
   ```bash
   # Tier 3 サーバ #1, #2 への ping
   ping edge-central-01.intereco.jp
   ping edge-central-02.intereco.jp

   # 物理アクセス可能なら iLO/iDRAC で電源状態
   ```

2. **process 確認**
   ```bash
   ssh edge-central-01
   systemctl status intereco-edge-agent
   journalctl -u intereco-edge-agent -n 100
   ```

3. **再起動**
   ```bash
   systemctl restart intereco-edge-agent
   # → 自動的に lease 取得 → 自動的にシャード claim
   ```

**確認**: 30 秒後に `/infra/nodes` で `active` 確認、Grafana で `edge_tenants_assigned` 復活確認

**監視への影響**: 各店舗の NVR は録画継続中 (per-store NVR が独立稼働)。
ライブ視聴・VOD のみ停止。**録画は失われない**。

### <a id="half-nodes-down"></a> HalfNodesDown — 片系障害

**症状**: Slack 警告 / `/infra/nodes` で 1 ノードが `down`

**自動対応**: ShardManager が 30〜90 秒以内に失効ノードの担当店舗を自動引取り (F49.A)。

**確認手順**

1. `/infra/nodes` で生存ノードが capacity 上限の 95% 以下か確認
2. 95% 超なら新規ノード追加を検討 (下記「中央ノードの追加」)

**失効ノードの復旧**

```bash
ssh edge-central-XX
systemctl restart intereco-edge-agent
# 起動後、unassigned 店舗を ShardManager が自動 claim する
```

### <a id="heartbeat-failure"></a> HeartbeatSuccessRateLow — 死活成功率低下

**症状**: 過去 24h の死活成功率 < 95% / 多数のサーキット OPEN

**原因切り分け**

1. **WAN 障害**: 特定 area_code に偏ってないか
   ```sql
   SELECT s.area_code, COUNT(*) FILTER (WHERE NOT m.reachable) AS fail, COUNT(*) AS total
   FROM stores s JOIN monitor_heartbeats m ON s.id = m.store_id
   WHERE m.recorded_at > now() - INTERVAL '6 hours'
   GROUP BY s.area_code ORDER BY fail DESC;
   ```

2. **NVR ベンダー特定**: FW バグ等
   ```sql
   SELECT s.nvr_vendor, s.nvr_model, COUNT(*) FILTER (WHERE NOT m.reachable) AS fail
   FROM stores s JOIN monitor_heartbeats m ON s.id = m.store_id
   WHERE m.recorded_at > now() - INTERVAL '6 hours'
   GROUP BY 1, 2 ORDER BY fail DESC;
   ```

3. **中央ノード負荷**: CPU/RAM が上限に達してないか (Grafana node_exporter)

**対応**

- WAN: 顧客 NW 担当に通報
- ベンダー要因: 該当機種一覧を顧客に共有、i-PRO サポート問合せ
- 負荷: 中央ノード追加

### <a id="command-failure"></a> CommandSuccessRateLow — コマンド失敗多発

**症状**: 過去 1h のコマンド成功率 < 95%

**原因切り分け**

```sql
-- 失敗パターン上位
SELECT command, error, COUNT(*) AS cnt
FROM pending_commands
WHERE status = 'failed' AND created_at > now() - INTERVAL '1 hour'
GROUP BY 1, 2 ORDER BY cnt DESC LIMIT 20;
```

**対応**

- `[CIRCUIT_OPEN]` プレフィックスが多い → サーキットブレーカー連鎖、NVR 側障害
- `auth_failed` 多発 → パスワード変更があった可能性、`/admin/stores` で認証情報再確認
- `timeout` 多発 → WAN 遅延、`nvr_options.timeoutMs` 引き上げ

### <a id="circuit-breaker"></a> ManyCircuitsOpen — 大量サーキット OPEN

**症状**: `edge_circuit_breaker_open_total > 100`

**確認**

```bash
# edge-agent ノードに ssh して内部状態確認 (Phase 4 で API 追加予定)
journalctl -u intereco-edge-agent | grep CIRCUIT_OPEN | tail -50
```

**強制リセット (本当に必要なら)**

```bash
# プロセス再起動でブレーカー全消去 (Phase 3 時点では in-memory)
systemctl restart intereco-edge-agent
```

⚠ Phase 4 で DB 永続化 + UI からのリセット機能を追加予定 (F49.D 後継)

---

## 計画作業

### 新規店舗の追加

1. `/admin/stores` で「+ 店舗追加」
2. `/admin/stores/<id>/nvr` で NVR 設定
   - ベンダー / 機種 / エンドポイント / 認証情報
3. 「接続テスト」で疎通確認
4. 「保存」で `deployment_mode='central_aggregator'` 自動セット (i-PRO 系の場合)
5. ShardManager が 1 分以内に自動 claim
6. `/infra/nodes` で担当ノード確認

### NVR 機種の追加

1. `/admin/nvr-models` → 「+ 機種追加」 (Phase 4 で実装予定)
2. ベンダー / 機種番号 / 表示名 / EOL/EOS / 仕様
3. capability マトリックス (`docs/tier3/firmware-capability-matrix.md`) も更新が必要な場合は PR
4. 新ベンダーの場合は adapter 実装が別途必要 → `docs/tier3/nvr-adapter-design.md` の手順に従う

### 中央ノードの追加

**ハードウェア**: Dell R660 + Ubuntu 24.04 LTS

```bash
# 1. systemd service 配置
sudo cp /etc/intereco/intereco-edge-agent.service.template /etc/systemd/system/intereco-edge-agent.service
sudo systemctl daemon-reload

# 2. UUID 生成 + 環境変数
sudo tee /etc/intereco/edge-agent.env <<EOF
CENTRAL_NODE_ID=$(uuidgen)
CENTRAL_REGION=ap-northeast-1
CENTRAL_CAPACITY=5000
METRICS_PORT=9464
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
EOF
sudo chmod 600 /etc/intereco/edge-agent.env

# 3. 起動
sudo systemctl enable --now intereco-edge-agent
sudo systemctl status intereco-edge-agent
```

**確認**:
- `/infra/nodes` で新ノード `active` + lease 取得済
- Prometheus `intereco-edge-central` ジョブで `up=1`
- 10 分以内に他ノードから rebalance で店舗が流入

### 中央ノードのメンテナンス

**drain → 停止 → 起動 の手順**

```bash
# 1. drain モード (新規受け取り停止)
sudo systemctl reload intereco-edge-agent
# (将来: SIGUSR1 で drain。現状は SIGTERM 一発で drain → stop)

# 2. 停止
sudo systemctl stop intereco-edge-agent
# → ShardManager.releaseAll() が走り、担当全店舗が解放される
# → 他ノードが順次 claim

# 3. メンテ作業 (FW 更新等)

# 4. 起動
sudo systemctl start intereco-edge-agent
# → 自動的に未割当店舗を claim
```

**注意**: drain 中の `lease_held_until` は 90 秒 TTL なので、メンテが長引く場合は手動で `central_nodes.status='down'` に SQL 更新 (他ノードのテイクオーバーを早める)。

### モード切替

#### per_store_minipc → central_aggregator (集約モードへ)

```bash
# 1. 該当店舗の NVR 設定が完了していることを確認
# 2. dry-run で対象確認
cd claude/monitor
node scripts/migrate-to-central.mjs --area=TOKYO

# 3. apply
node scripts/migrate-to-central.mjs --area=TOKYO --apply

# 4. ShardManager が自動 claim → /infra/nodes で確認
```

#### central_aggregator → per_store_minipc (Mini PC モードへ戻す)

```bash
# rollback
node scripts/migrate-to-central.mjs --rollback --ids=<uuid> --apply
# → central_node_id=NULL に設定、各店舗の Mini PC で Frigate を起動する
```

### ハートビート間隔の段階展開

```bash
# 現状確認
node scripts/heartbeat-rollout.mjs --status

# まだオーバーライド未設定の店舗を 100 件だけ 6h に切替
node scripts/heartbeat-rollout.mjs --set-to=21600 --only-unset --limit=100 --apply

# 1 週間運用して問題なければ次の 100 件...
```

---

## リリース手順

### Blue/Green デプロイ

```bash
# Tier 3 サーバ #1, #2 のうち #2 を draining に
ssh edge-central-02 'sudo systemctl reload intereco-edge-agent'

# #1 が全店舗を引き取るのを Grafana で確認 (1〜2 分)

# #2 を停止 → 新バージョン deploy → 起動
ssh edge-central-02 << 'EOF'
sudo systemctl stop intereco-edge-agent
cd /opt/intereco-edge-agent
git pull && bun install --frozen-lockfile && bun run build
sudo systemctl start intereco-edge-agent
EOF

# #2 動作確認後、#1 を同様にローリング更新
```

### ロールバック

```bash
# git tag で前バージョンに戻して再 deploy
ssh edge-central-02 << 'EOF'
cd /opt/intereco-edge-agent
git checkout v<previous-tag>
bun install --frozen-lockfile && bun run build
sudo systemctl restart intereco-edge-agent
EOF
```

---

## 災害復旧

### Supabase 障害時

- 中央エージェントは pending_commands を実行できなくなるが、**adapter cache に残った接続は使い続けられる**
- ライブ視聴は WHIP セッションが切れるまで継続
- 死活監視は Supabase 復旧後に再開
- **データロスト無し**: NVR 側で録画継続

### 中央サーバ全滅 (DC 障害)

- 各店舗の NVR は録画継続
- ライブ・VOD は不可
- 復旧後、`scripts/migrate-to-central.mjs --rollback --apply` で全店舗を Mini PC モードに緊急退避するオプションあり (各店に Mini PC が配備済の場合)

---

## 連絡先

| 役割 | 担当 | 連絡 |
|---|---|---|
| 一次オンコール | Intereco 運用 | PagerDuty |
| エスカレ | プロダクト責任者 | 電話 / Slack |
| i-PRO サポート | i-PRO 法人窓口 | TEL / メール |
| Supabase サポート | プラン依存 | Dashboard |
| データセンター | コロケーション業者 | 24h 緊急 TEL |

(具体的な連絡先は本番運用開始時に追記)

---

## 改訂履歴

| 日付 | 内容 | 担当 |
|---|---|---|
| 2026-06-04 | F51.X 初版作成 | (自動生成) |

## 関連ドキュメント

- `monitoring/README.md` — 監視スタック設計
- `nvr-adapter-design.md` — adapter 層
- `eol-eos-data-model.md` — ライフサイクル管理
- `customer-nvr-survey.md` — 顧客機種調査
