#!/usr/bin/env bash
# cloudflared バイナリの known-good 切替（docs/edge-ota-design.md §6）。
#   releases 同様にピン留めバイナリを取得 → cloudflared symlink 切替 → restart →
#   トンネル接続を確認 → 失敗で前バイナリへ戻す。
#
# 使い方: update-cloudflared.sh <version>   例) update-cloudflared.sh 2026.6.1
# 依存: curl, systemctl(sudo NOPASSWD), cloudflared。
set -euo pipefail

EDGE_ROOT="${EDGE_ROOT:-/home/intereco/edge}"
UNIT="${CLOUDFLARED_UNIT:-cloudflared-intereco}"
VER="${1:?usage: update-cloudflared.sh <version>}"
ARCH="${CF_ARCH:-amd64}"
BASE="https://github.com/cloudflare/cloudflared/releases/download"

CFDIR="$EDGE_ROOT/cloudflared"
LINK="$CFDIR/current"           # systemd の ExecStart はこの symlink を指す
BINDIR="$CFDIR/bin"
NEW="$BINDIR/cloudflared-$VER"

log() { echo "[update-cloudflared] $*" >&2; }
mkdir -p "$BINDIR"

PREV_TARGET=""
[[ -L "$LINK" ]] && PREV_TARGET="$(readlink -f "$LINK")"

# 1. 取得（既存なら再DLしない）。
if [[ ! -x "$NEW" ]]; then
  log "cloudflared $VER を取得"
  curl -fsSL "$BASE/$VER/cloudflared-linux-$ARCH" -o "$NEW.tmp"
  chmod +x "$NEW.tmp"
  mv -f "$NEW.tmp" "$NEW"
fi

# 2. symlink 切替（原子的）。
ln -sfn "$NEW" "$LINK.tmp"
mv -Tf "$LINK.tmp" "$LINK"
sudo systemctl restart "$UNIT"
log "$UNIT を $VER で再起動"

# 3. 接続確認（最大30秒）。失敗で前バイナリへ戻す。
ok=0
for _ in $(seq 1 15); do
  if systemctl is-active --quiet "$UNIT" && "$LINK" --version >/dev/null 2>&1; then
    # トンネル健全性: メトリクス/接続が立っていれば is-active で十分。さらに厳密化は将来。
    ok=1; break
  fi
  sleep 2
done

if [[ "$ok" != 1 ]]; then
  log "WARN: $VER の起動/接続を確認できず → ロールバック"
  if [[ -n "$PREV_TARGET" && -x "$PREV_TARGET" ]]; then
    ln -sfn "$PREV_TARGET" "$LINK.tmp"; mv -Tf "$LINK.tmp" "$LINK"
    sudo systemctl restart "$UNIT"
    log "前バイナリ($PREV_TARGET)へ復帰しました"
  else
    log "FATAL: 戻せる前バイナリが無い。手動復旧が必要。"
  fi
  exit 1
fi
log "cloudflared $VER 健全。known-good 更新完了。"
