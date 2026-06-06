# Monitoring Stack (Docker Compose)

F87 で `docker-compose.yml` を実装予定。

## 構成
- prometheus/   メトリクス収集 (7日保持)
- grafana/      ダッシュボード + アラート
- loki/         ログ集約 (30日保持)
- alertmanager/ 通知ルーティング
- pushgateway/  edge-agent からの push 受け口
- caddy/        TLS 自動 + リバプロ

## ボリューム
- prometheus_data:  /var/lib/docker/volumes/...
- grafana_data:     (datasources + dashboards は provisioning で固定)
- loki_data:        ログ実体
- caddy_data:       Let's Encrypt 証明書

## 起動
```bash
cd infra/monitoring
docker compose up -d
```
