#!/usr/bin/env bash
# known-good へロールバック（層2: systemd OnFailure / 手動の最後の砦）。
#   1. current シンボリックリンクを known-good の指す release へ戻す（原子的）
#   2. ota-state.json を整合（running=known-good, status=rolled_back, last_failed=失敗版, pending_verify クリア）
#      ← これをしないと次回起動で agent が「known-good を新版として promote」する誤動作になる
#   3. intereco-edge を再起動して旧版で立て直す
#
# 使い方: rollback-edge.sh [reason]
# 依存: bun（JSON整合・agent と同じランタイム）, readlink, ln, mv。
set -euo pipefail

EDGE_ROOT="${EDGE_ROOT:-/home/intereco/edge}"
UNIT="${EDGE_AGENT_UNIT:-intereco-edge}"
BUN="${BUN_BIN:-/home/intereco/.bun/bin/bun}"
REASON="${1:-manual_rollback}"

STATE="$EDGE_ROOT/shared/ota-state.json"
CURRENT="$EDGE_ROOT/current"
KNOWN_GOOD="$EDGE_ROOT/known-good"

log() { echo "[rollback-edge] $*" >&2; }

if [[ ! -e "$KNOWN_GOOD" ]]; then
  log "FATAL: known-good が無い（$KNOWN_GOOD）。手動復旧が必要。"
  exit 1
fi

# 1. current -> known-good の実体へ（原子的: tmp symlink → mv -T）。
GOOD_TARGET="$(readlink -f "$KNOWN_GOOD")"
ln -sfn "$GOOD_TARGET" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"
log "current → $GOOD_TARGET に戻しました"

# 2. ota-state.json を整合（壊れていても落ちないよう best-effort）。
if [[ -x "$BUN" ]]; then
  EDGE_ROOT="$EDGE_ROOT" REASON="$REASON" "$BUN" -e '
    const fs = require("fs");
    const p = process.env.EDGE_ROOT + "/shared/ota-state.json";
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    const good = s.known_good_version ?? s.running_version ?? null;
    const failed = s.pending_verify_version ?? s.last_failed_version ?? null;
    const next = {
      ...s,
      running_version: good,
      known_good_version: good,
      pending_verify_version: null,
      last_failed_version: failed,
      status: "rolled_back",
      last_error: process.env.REASON,
      updated_at: new Date().toISOString(),
    };
    fs.mkdirSync(require("path").dirname(p), { recursive: true });
    fs.writeFileSync(p + ".tmp", JSON.stringify(next, null, 2) + "\n");
    fs.renameSync(p + ".tmp", p);
  ' || log "WARN: ota-state.json 整合に失敗（symlink は戻済み・続行）"
  log "ota-state.json を rolled_back に更新（reason=$REASON）"
else
  log "WARN: bun が無い（$BUN）。ota-state.json は手動確認推奨。"
fi

# 3. 旧版で立て直す。
sudo systemctl restart "$UNIT"
log "$UNIT を再起動しました（known-good で復帰）"
