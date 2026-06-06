# 負荷試験キット (F50.D)

実機 NVR なしで Tier 3 中央集約モードのスケーラビリティを検証するためのツール群。

## ファイル

| ファイル | 役割 |
|---|---|
| `mock-nvr-server.mjs` | i-PRO WJ-NX CGI/ONVIF を模した HTTP サーバ。複数ポートで N 台を同時に立てられる |
| `seed-mock-stores.mjs` | Supabase に N 個のテスト店舗を投入 (cleanup あり) |

## 推奨フロー

### 1. 100 店舗テスト (動作確認用)

```bash
# Step 1: モック NVR を 100 台起動
node scripts/load-test/mock-nvr-server.mjs --multi=100 --base-port=18443 &

# Step 2: Supabase に 100 店舗投入 (各店舗が mock-nvr の各ポートを指す)
node scripts/load-test/seed-mock-stores.mjs --count=100 --base-port=18443

# Step 3: edge-agent を中央モードで起動
cd claude/edge-agent
CENTRAL_NODE_ID=$(uuidgen) \
NEXT_PUBLIC_SUPABASE_URL=$SUPA_URL \
SUPABASE_SERVICE_ROLE_KEY=$SUPA_KEY \
METRICS_PORT=9464 \
bun run src/index.ts central

# Step 4: メトリクス確認
curl http://localhost:9464/metrics | grep -E '^edge_'

# Step 5: 後片付け
node scripts/load-test/seed-mock-stores.mjs --cleanup
```

### 2. 1,000 店舗テスト (キャパシティ計測)

```bash
# モック NVR 1000 台 (port 18443..19442)
node scripts/load-test/mock-nvr-server.mjs --multi=1000 --base-port=18443 &

# 店舗 1000 投入
node scripts/load-test/seed-mock-stores.mjs --count=1000

# edge-agent を起動 — capacity を 1000 に上げる
CENTRAL_NODE_ID=... CENTRAL_CAPACITY=1000 bun run ...
```

### 3. Active-Active テスト (HA 検証)

2 台の edge-agent を起動して、片方を kill。残った 1 台が引き取るか確認。

```bash
# Node A
CENTRAL_NODE_ID=11111111-1111-1111-1111-111111111111 \
CENTRAL_CAPACITY=600 bun run ... &

# Node B
CENTRAL_NODE_ID=22222222-2222-2222-2222-222222222222 \
CENTRAL_CAPACITY=600 bun run ... &

# しばらく待つ → /infra/nodes で 2 ノードが ~500 店ずつ持ってる
# Node A を kill -9 → 90 秒後 (lease TTL) に Node B が全 1000 店持ってる
```

### 4. Chaos テスト (障害シミュレーション)

```bash
# 10% の確率で失敗 + 平均 200ms 遅延
node scripts/load-test/mock-nvr-server.mjs --multi=100 --base-port=18443 \
  --latency-ms=200 --fail-rate=0.1 &

# circuit breaker が動作することを確認
curl http://localhost:9464/metrics | grep edge_circuit_breaker_open
```

### 5. EOS 機種テスト

```bash
node scripts/load-test/mock-nvr-server.mjs --multi=100 \
  --model=WJ-NX200K --fw=1.20-0001 &   # 古い世代 (v1.x)

# capability matrix で v1.x の capability になることを確認
```

## メトリクス確認ポイント

```bash
# 担当店舗数 (期待: capacity 内)
curl -s http://localhost:9464/metrics | grep edge_tenants_assigned

# コマンド処理レート
curl -s http://localhost:9464/metrics | grep edge_commands_total

# 平均レイテンシ (95p / 99p は Prometheus で aggregate)
curl -s http://localhost:9464/metrics | grep edge_command_duration_seconds

# サーキットブレーカー OPEN 数
curl -s http://localhost:9464/metrics | grep edge_circuit_breaker_open
```

## SLO 目標

| メトリクス | 目標 |
|---|---|
| `edge_tenants_assigned` | capacity の 95% 以下 |
| `edge_commands_total{result="ok"}` 比率 | 99.5% 以上 |
| `edge_command_duration_seconds` p95 | 2 秒以下 |
| `edge_heartbeat_total{result="ok"}` 比率 | 99% 以上 |

## トラブルシューティング

| 症状 | 確認 |
|---|---|
| 担当店舗数が増えない | `central_nodes.lease_held_until` が古くないか? |
| 全 OK だが metrics に出ない | METRICS_PORT が衝突していないか? |
| Mock NVR が EADDRINUSE | `--base-port` を別の範囲に変更 |
| Supabase レート制限 | `--count` を 500 以下に分割 |
