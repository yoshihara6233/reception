#!/usr/bin/env bash
#
# nvms アダプタの通し検証 — 隔離した本物の nvmsd に対して、アダプタ実物で
# snapshot / recordings/export を叩き、JPEG/MP4 と SHA-256 照合まで確かめる。
#
# 前提: NVMS リポジトリ(NVMS_DIR)・nvms-postgres コンテナ(:5442)・
#       シミュレータ mediamtx(:9554, NVMS/sim/start-sim.sh) が動いていること。
# 冪等: 専用 DB (nvms_edge_adapter_e2e) と一時ディレクトリを毎回作って毎回消す。
#
# ⚠ 落とし穴（2026-09-14 実測）: NVMS_SNAPSHOT_ALL=false を渡すと AI 無効カメラの
#   スナップショット出力が**完全に止まり**、グリッド/ライブが 404 のままになる。
#   NVMS の既定は SNAPSHOT_ALL=true + SNAPSHOT_ON_DEMAND=true（見られている
#   カメラだけ 1fps 出力）で、本番はそのままで動く。ここでも既定値に任せる。
# NVMS × edge-agent nvms アダプタの通し検証（隔離インスタンス・冪等）
set -uo pipefail
NVMS="${NVMS_DIR:-$HOME/claude/NVMS}"
PORT=18090
DB_NAME=nvms_edge_adapter_e2e
PSQL="docker exec nvms-postgres psql -U nvms"
DB_URL="postgres://nvms:nvms_dev_password@127.0.0.1:5442/${DB_NAME}"
WORK=$(mktemp -d /tmp/nvms-edge-e2e.XXXXXX)
ADMIN_PASS="e2e-$(openssl rand -hex 8)"
PID=""
cleanup(){ [ -n "$PID" ] && kill "$PID" 2>/dev/null; sleep 1;
  p=$(lsof -ti :$PORT 2>/dev/null); [ -n "$p" ] && kill -9 $p 2>/dev/null
  $PSQL -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)" >/dev/null 2>&1
  rm -rf "$WORK"; }
trap cleanup EXIT

$PSQL -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)" >/dev/null 2>&1
$PSQL -c "CREATE DATABASE ${DB_NAME}" >/dev/null || { echo "DB作成失敗"; exit 1; }

NVMS_HTTP_ADDR=":${PORT}" \
NVMS_DATABASE_URL="$DB_URL" \
NVMS_DATA_DIR="$WORK/data" \
NVMS_ADMIN_PASSWORD="$ADMIN_PASS" \
NVMS_SEGMENT_SECONDS=10 \
NVMS_RETENTION_DAYS=1 \
"$NVMS/nvmsd" >"$WORK/nvmsd.log" 2>&1 &
PID=$!

for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/api/v1/health" >/dev/null && break; sleep 1; done
curl -sf "http://127.0.0.1:$PORT/api/v1/health" >/dev/null || { echo "起動失敗"; tail -20 "$WORK/nvmsd.log"; exit 1; }
echo "✅ nvmsd 起動 (:$PORT)"

JAR="$WORK/jar"
curl -s -c "$JAR" -X POST "http://127.0.0.1:$PORT/api/v1/auth/login" \
  -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}" >/dev/null
KEY=$(curl -s -b "$JAR" -X POST "http://127.0.0.1:$PORT/api/v1/apikeys" \
  -H 'Content-Type: application/json' -d '{"name":"edge-adapter-e2e","role":"operator"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["key"])')
[ -n "$KEY" ] || { echo "APIキー発行失敗"; exit 1; }
echo "✅ operator API キー発行 (${KEY:0:10}…)"

CAM=$(curl -s -b "$JAR" -X POST "http://127.0.0.1:$PORT/api/v1/cameras" \
  -H 'Content-Type: application/json' \
  -d '{"name":"e2e-sim-cam1","rtsp_url":"rtsp://127.0.0.1:9554/sim/cam1","enabled":true}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
[ -n "$CAM" ] || { echo "カメラ登録失敗"; exit 1; }
echo "✅ カメラ登録 id=$CAM (sim :9554)"

echo "… 録画セグメント生成待ち (35秒)"
sleep 35

FROM=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=25)).isoformat().replace("+00:00","Z"))')
TO=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=5)).isoformat().replace("+00:00","Z"))')

cd /Users/junji.y/claude/Intereco/monitor-recover/claude/edge-agent
NVMS_E2E_HOST="127.0.0.1:$PORT" NVMS_E2E_KEY="$KEY" NVMS_E2E_CAM="$CAM" \
NVMS_E2E_FROM="$FROM" NVMS_E2E_TO="$TO" \
bun run "$(dirname "$0")/e2e-nvms-probe.ts"
RC=$?
if [ $RC -ne 0 ]; then
  echo "── 診断: camera status ──"
  curl -s -b "$JAR" "http://127.0.0.1:$PORT/api/v1/cameras/$CAM/status" | head -c 400; echo
  echo "── 診断: nvmsd.log (camera/snapshot/ingest) ──"
  grep -iE "camera|snapshot|ingest|error" "$WORK/nvmsd.log" | tail -25
fi
exit $RC
