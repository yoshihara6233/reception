#!/usr/bin/env bash
#
# E2E 用の dev サーバ起動。ローカル Supabase の接続情報を `supabase status` から
# 受け取ってから next dev を起動する。
#
# **鍵をファイルに書かない**のが要点。`.env.local` を作る方式にすると、
# ローカルの鍵が別のブランチや別プロジェクトへ紛れ込む事故が起きる
# （2026-08-09 に設定ファイルへ焼き付いた秘密情報を 23 件除去したばかり）。
# ここでは環境変数として渡すだけで、ディスクには残さない。
#
# 使い方: scripts/e2e-dev.sh [PORT]   ※ playwright.config.ts の webServer から呼ばれる
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${1:-3210}"

if ! bunx supabase status >/dev/null 2>&1; then
  echo "ERROR: ローカル Supabase が起動していません。" >&2
  echo "  bunx supabase start && bunx supabase db reset" >&2
  exit 1
fi

# ANON_KEY / API_URL / SERVICE_ROLE_KEY などを KEY="value" 形式で受け取る。
eval "$(bunx supabase status -o env)"

# 保険: 万一 supabase status がリモートを返したら起動しない。
# E2E は seed を書き込み、ロール境界を総当たりで叩く。向き先を間違えたまま
# 走らせるのは事故そのものなので、疑わしい時点で止める。
case "${API_URL}" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "ERROR: ローカル以外の Supabase を指しています: ${API_URL}" >&2; exit 1 ;;
esac

# Next は .env.local も読むが、**既に設定されている環境変数を上書きしない**。
# つまりここで export した値が勝つ＝各自の .env.local の向き先に引きずられない。
export NEXT_PUBLIC_SUPABASE_URL="${API_URL}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}"

# 外部への送信を伴う env は**あえて設定しない**。未設定時にフェイルクローズ
# （webhook は 500、メールは送らない）することまで含めて E2E の対象なので、
# ここで値を入れてしまうとその検証ができなくなる。

exec ./node_modules/.bin/next dev -p "${PORT}"
