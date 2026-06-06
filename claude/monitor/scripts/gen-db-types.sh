#!/usr/bin/env bash
# F46.9: Supabase DB 型自動生成
#
# 使い方:
#   cd claude/monitor && ./scripts/gen-db-types.sh
#
# 出力: src/lib/supabase/db-types.ts
#
# 前提:
#   1. SUPABASE_PROJECT_ID が環境変数で設定されているか .env.local に記載
#   2. supabase CLI がインストール済 (`brew install supabase/tap/supabase`)
#   3. supabase login 済み
#
# ローカル DB から生成する場合は SUPABASE_LOCAL=1 を付ける:
#   SUPABASE_LOCAL=1 ./scripts/gen-db-types.sh

set -euo pipefail

OUT=src/lib/supabase/db-types.ts
mkdir -p "$(dirname "$OUT")"

# .env.local から SUPABASE_PROJECT_ID を読み込む (なければ環境変数)
if [ -f .env.local ] && [ -z "${SUPABASE_PROJECT_ID:-}" ]; then
  SUPABASE_PROJECT_ID=$(grep -E '^SUPABASE_PROJECT_ID=' .env.local | cut -d= -f2- | tr -d '"' | tr -d "'") || true
fi

if [ "${SUPABASE_LOCAL:-0}" = "1" ]; then
  echo "→ ローカル Supabase から型生成中..."
  supabase gen types typescript --local > "$OUT"
elif [ -n "${SUPABASE_PROJECT_ID:-}" ]; then
  echo "→ プロジェクト $SUPABASE_PROJECT_ID から型生成中..."
  supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" > "$OUT"
else
  echo "ERROR: SUPABASE_PROJECT_ID が未設定です"
  echo "  .env.local に追加するか、環境変数で指定してください"
  echo "  または SUPABASE_LOCAL=1 でローカル DB から生成してください"
  exit 1
fi

# ヘッダコメント追加
TMP=$(mktemp)
{
  echo "/**"
  echo " * F46.9: Auto-generated Supabase DB types"
  echo " *"
  echo " * 再生成: cd claude/monitor && ./scripts/gen-db-types.sh"
  echo " *"
  echo " * 編集禁止 — supabase gen types typescript の出力をそのまま反映"
  echo " * NVR Adapter で参照する型は src/lib/nvr-adapter/types.ts を使用"
  echo " */"
  cat "$OUT"
} > "$TMP"
mv "$TMP" "$OUT"

echo "✓ $OUT 生成完了 ($(wc -l < "$OUT") lines)"
