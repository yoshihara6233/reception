#!/usr/bin/env bash
# 一度きり: 既存の PoC 機（git チェックアウトを直実行）を OTA レイアウトへ移行する。
#   $EDGE_ROOT/{repo, releases/<sha0>, current->releases/<sha0>, known-good->releases/<sha0>,
#              shared/{agent.env, ota-state.json}, bin}
# 既存の .env を shared/agent.env に集約し、現行コミットを sha0 release として封入する。
#
# 使い方: SRC=/home/intereco/intereco setup-layout.sh
#   SRC = 既存チェックアウト（リポジトリルート。claude/edge-agent を含む）。
set -euo pipefail

EDGE_ROOT="${EDGE_ROOT:-/home/intereco/edge}"
SRC="${SRC:-/home/intereco/intereco}"
BUN="${BUN_BIN:-/home/intereco/.bun/bin/bun}"

log() { echo "[setup-layout] $*" >&2; }

[[ -d "$SRC/.git" ]] || { log "FATAL: SRC=$SRC が git リポジトリでない"; exit 1; }
[[ -d "$SRC/claude/edge-agent" ]] || { log "FATAL: $SRC/claude/edge-agent が無い"; exit 1; }

SHA0="$(git -C "$SRC" rev-parse --short HEAD)"
log "現行コミット sha0=$SHA0 を初期 release にします"

mkdir -p "$EDGE_ROOT"/{repo,releases,shared,bin}

# repo: fetch 専用の作業リポジトリ（current とは独立。worktree の親）。
if [[ ! -d "$EDGE_ROOT/repo/.git" ]]; then
  git clone "$SRC" "$EDGE_ROOT/repo"
fi
git -C "$EDGE_ROOT/repo" remote set-url origin "$(git -C "$SRC" remote get-url origin)" || true

# releases/<sha0>: 現行コミットの worktree。
REL0="$EDGE_ROOT/releases/$SHA0"
if [[ ! -e "$REL0/VERSION" ]]; then
  git -C "$EDGE_ROOT/repo" fetch --depth 50 origin || true
  git -C "$EDGE_ROOT/repo" worktree add --force --detach "$REL0" "$SHA0"
  ( cd "$REL0/claude/edge-agent" && "$BUN" install --frozen-lockfile )
  echo "$SHA0" > "$REL0/VERSION"
fi

# shared/agent.env: 既存 .env を集約（無ければ手動配置）。
if [[ ! -e "$EDGE_ROOT/shared/agent.env" ]]; then
  if [[ -e "$SRC/claude/edge-agent/.env" ]]; then
    cp "$SRC/claude/edge-agent/.env" "$EDGE_ROOT/shared/agent.env"
    log "既存 .env を shared/agent.env にコピーしました"
  else
    log "WARN: shared/agent.env を手動配置してください（EDGE_ID/DEVICE_TOKEN/MONITOR_URL/EDGE_ROOT 等）"
  fi
fi
# release は機密を持たない。env は systemd の EnvironmentFile で渡す。
rm -f "$REL0/claude/edge-agent/.env" 2>/dev/null || true

# current / known-good を sha0 に向ける。
ln -sfn "$REL0" "$EDGE_ROOT/current"
ln -sfn "$REL0" "$EDGE_ROOT/known-good"

# 初期 ota-state.json。
cat > "$EDGE_ROOT/shared/ota-state.json" <<JSON
{
  "running_version": "$SHA0",
  "known_good_version": "$SHA0",
  "pending_verify_version": null,
  "last_failed_version": null,
  "status": "idle",
  "attempts": 0,
  "last_error": null,
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

# bin スクリプト配置。
cp "$SRC/claude/edge-agent/deploy/ota/bin/"*.sh "$EDGE_ROOT/bin/"
chmod +x "$EDGE_ROOT/bin/"*.sh

log "完了。次は agent.env に EDGE_ROOT=$EDGE_ROOT を追記し、systemd ユニット差替（RUNBOOK 参照）。"
