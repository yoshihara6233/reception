# Tier 3 監視スタック 設計 (F51.F)

> Phase 3 後半で中央集約モードを本番稼働させるための監視構成。
> Prometheus + Grafana + Loki + Alertmanager を Tier 3 サーバに同居 (or 別サーバ)
> させて、edge-agent からのメトリクスを継続収集し、SLO 違反を自動通知する。

## 構成図

```
┌─ 中央 DC ────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌─ edge-agent ノード ──────┐    ┌─ 監視スタック ──────────────┐  │
│  │ • Node A (Active)        │    │                              │  │
│  │   :9464 /metrics ───────┼────┼──> Prometheus :9090          │  │
│  │   pino logs JSON ───────┼────┼──> Loki :3100                │  │
│  │                          │    │       │                      │  │
│  │ • Node B (Active)        │    │       ├──> Grafana :3000     │  │
│  │   :9464 /metrics ───────┼────┼──>    │                      │  │
│  │                          │    │       └──> Alertmanager      │  │
│  └──────────────────────────┘    │            :9093             │  │
│                                  │              │               │  │
│                                  │              ▼               │  │
│                                  │       Slack / PagerDuty /    │  │
│                                  │       メール                  │  │
│                                  └──────────────────────────────┘  │
│                                                                    │
│        ┌─ Supabase (PostgreSQL + Storage) ─┐                        │
│        │  • stores                          │ <── edge-agent書込   │
│        │  • central_nodes                   │     monitor 読込     │
│        │  • monitor_heartbeats              │                      │
│        │  • pending_commands                │                      │
│        └────────────────────────────────────┘                       │
└────────────────────────────────────────────────────────────────────┘
```

## ファイル一覧

| ファイル | 内容 |
|---|---|
| `prometheus.yml` | scrape_configs テンプレート |
| `alertmanager.yml` | アラートルーティング設定 |
| `alert-rules.yml` | SLO 違反 / 異常検知ルール |
| `grafana-dashboard-overview.json` | 全体俯瞰ダッシュボード |
| `grafana-dashboard-slo.json` | SLO 専用ダッシュボード |
| `grafana-datasources.yml` | データソース provisioning |
| `loki-config.yml` | Loki 設定 |
| `docker-compose.yml` | 一発起動用 (PoC / 検証環境) |

## デプロイ方式

### 案 A: Tier 3 サーバ同居 (推奨)

```
Dell R660 #1
├── edge-agent (Node A)              :9464
├── prometheus                       :9090
├── grafana                          :3000
├── loki                             :3100
└── alertmanager                     :9093

Dell R660 #2
├── edge-agent (Node B)              :9464
└── (read replica) prometheus        :9090
```

- 1 ノード障害時の独立性を保つため、Prometheus は両ノードに置き、HA で動かす
- Grafana は #1 主、#2 にフェイルオーバー設定

### 案 B: 別サーバ集約 (中・大規模)

別の小型 Mini PC や VM に監視スタックを集約。Prometheus は Tier 3 サーバから scrape する。

```
Tier 3 #1 (edge-agent A)  :9464  ──┐
Tier 3 #2 (edge-agent B)  :9464  ──┼──> 監視サーバ Prometheus  :9090
                                    │       ├── Grafana  :3000
                                    │       ├── Loki     :3100
                                    │       └── Alertmanager :9093
```

## メトリクス命名規則

| Prefix | 用途 |
|---|---|
| `edge_*` | edge-agent (central runner) のメトリクス |
| `node_*` | 既存 Node Exporter のシステムメトリクス (CPU/RAM/Disk) |
| `process_*` | Node.js プロセスメトリクス (heap/eventloop) |

詳細は `claude/edge-agent/src/util/metrics.ts` を参照。

## SLO ターゲットとアラート

| SLO | 目標 | アラート閾値 | 通知先 |
|---|---|---|---|
| 死活監視成功率 | 99% | 24h 移動平均 < 98% で警告 / < 95% で緊急 | Slack / メール |
| コマンド成功率 | 99.5% | 1h 移動平均 < 99% で警告 / < 95% で緊急 | Slack / メール |
| ノード稼働率 | 99.9% | 5 分連続で稼働ノード = 0 で 緊急 | PagerDuty |
| p95 latency | 2.0s | 5 分移動平均で > 5s が継続したら警告 | Slack |

## 運用フロー

### 1. 通常運用 (定期確認)

- 月次: Grafana SLO ダッシュボードでエラーバジェット消費を確認
- 週次: アラート発生ログを Grafana → Loki で振り返り
- 日次: ダッシュボードの異常スパイクを目視

### 2. SLO 違反検知時

1. Alertmanager から Slack / メール / PagerDuty へ通知
2. Runbook (本 docs の `../operations-runbook.md`) で対応手順
3. ポストモーテム → ランブック更新

### 3. 新規 NVR ベンダー追加時

1. adapter 実装 (Phase 5+)
2. メトリクスラベル `vendor=foo` が自動追加されることを確認
3. Grafana ダッシュボードに新ベンダー用パネルを追加

## デプロイ手順 (検証環境)

```bash
cd docs/tier3/monitoring
docker compose up -d
# Prometheus: http://localhost:9090
# Grafana:    http://localhost:3000 (admin / changeme)
# Loki:       http://localhost:3100

# edge-agent を起動 (中央モード) — METRICS_PORT=9464
# Prometheus が localhost:9464/metrics を scrape する
```

## セキュリティ

- /metrics エンドポイントは内部 LAN からのみアクセス可 (FW で制限)
- Grafana 認証は OIDC または LDAP 連携を推奨
- Alertmanager の Webhook は signed URL or HMAC で保護
- Loki のログには NVR パスワード等の機密情報を含めない (logger.ts で redaction)

## 関連ドキュメント

- `../nvr-adapter-design.md` — adapter 層 (メトリクス出力源)
- `../eol-eos-data-model.md` — ライフサイクル管理 (Grafana で可視化)
- `../../../claude/edge-agent/src/util/metrics.ts` — メトリクス実装
- `../operations-runbook.md` — 障害対応ランブック (F51.X)
