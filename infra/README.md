# Intereco Infrastructure

Phase 11 で構築する自社運用監視スタック。すべて Hetzner Cloud 1 VM
+ Docker Compose で動かし、年間 ¥30,000 程度で 100-10,000 拠点を
カバーする想定。

## 📁 ディレクトリ構成

```
infra/
├── monitoring/      Docker Compose stack (F87 で実装)
│   ├── docker-compose.yml
│   ├── prometheus/  メトリクス収集 (7 日保持)
│   ├── grafana/     ダッシュボード + アラートルール
│   ├── loki/        ログ集約 (30 日保持)
│   ├── alertmanager/ 通知ルーティング (→ Next.js webhook)
│   ├── pushgateway/ edge-agent からの push 受け口
│   └── caddy/       TLS 自動 (Let's Encrypt) + リバプロ
│
├── ansible/         Hetzner VM プロビジョン (F86 で実装)
│   ├── inventory/
│   ├── playbooks/
│   └── roles/
│
└── runbooks/        運用手順書 (F104 で完成)
```

## 🎯 全体アーキテクチャ

```
[Hetzner CX32 €7.59/月]
├─ Prometheus (scrape + Pushgateway)
├─ Grafana (dashboards + alerting)
├─ Loki (logs)
├─ Alertmanager → Next.js /api/alert/dispatch
└─ Caddy (TLS reverse proxy)
   - grafana.intereco.io
   - pushgateway.intereco.io (TLS + bearer auth)

[Vercel Monitor]                        [Beelink edge-agents]
- OpenTelemetry → Pushgateway          - /metrics + promtail
- /status (顧客向け公開ページ)         - logs → Loki
- /api/alert/dispatch (Slack + SMS)    - heartbeat → Supabase
- /admin/oncall (輪番管理)
```

## 📊 月額コスト

| サービス | 料金 |
|---|---|
| Hetzner CX32 (4 vCPU/8GB) | €7.59 |
| Hetzner Storage Box 1TB (backup) | €3.20 |
| Twilio (国際 SMS, ~50通/月想定) | ~¥1,000 |
| Cloudflare DNS + Health Check | 無料 |
| **合計** | **~¥2,700/月** |

## 🚀 着手前の前提

| 項目 | 状態 |
|---|---|
| Phase 11 計画書 | ✅ ([本ファイル](.) 参照) |
| タスク登録 | ✅ F86-F104 (19件) |
| 必要アカウント | ⏳ ([pre-flight-checklist.md](./pre-flight-checklist.md) 参照) |
| ディレクトリ構造 | ✅ (本ファイルがあるディレクトリ) |
| 着手 | ⏸ (チェックリスト完了後) |

## 📋 着手手順

1. [pre-flight-checklist.md](./pre-flight-checklist.md) を上から順にチェック
2. 全項目 ✅ になったら F86 (Hetzner VM 調達) から実装開始
3. 各タスクは独立してマージ可能 (依存関係はタスク内に記載)

## 📚 参考

- 監視スタック設計ドキュメント: `docs/tier3/monitoring/`
- Phase 11 計画 (本ファイル冒頭参照)
- F51.F (元設計): タスク #111
