# intereco-edge-images — ライブ画像の R2 ゲート Worker

16分割 `grid.jpg` とカメラ別 `snapshot.jpg` を **自社ドメイン `img.genesis-edge.com` 経由**で
R2 に読み書きする Worker。Supabase の課金エグレスを止めるのが目的。

## なぜ Worker が要るか（R2 の S3 API を直接使わない理由）

2026-08-03 の実測（PoC Beelink 店・eo光）:

| 宛先 | 結果 |
|---|---|
| `*.r2.cloudflarestorage.com`（R2 の S3 API） | **SSL handshake failure = SNI 遮断** |
| `pub-*.r2.dev` | 到達可 |
| `go2rtc-poc.genesis-edge.com`（既存トンネル） | 到達可 |
| `cloudflare.com` / `api.cloudflare.com` | 到達可 |

遮断されているのは **`r2.cloudflarestorage.com` というホスト名だけ**で、Cloudflare 全体ではない。
そのため S3 API（presigned PUT/GET）方式ではこの店で一切機能せず、静かに Supabase へ
フォールバックし続ける（＝エグレス削減がゼロ）。

本 Worker は **R2 バインディング**でバケットを直接読み書きするので、遮断ホスト名を踏まない。
同種のフィルタを持つ顧客店舗でも同じ問題が起きうるため、恒久対策として全店でこの経路を使う。

## 認証

monitor（`claude/monitor/src/lib/storage/edge-images-sign.ts`）と**同じ鍵**の短TTL HMAC。
正規化文字列は厳密一致で `${method}\n${key}\n${exp}`。

- `method` を署名対象に含めるため、**PUT 署名で GET はできない**（逆も同様）。
- キーは正規表現で `edges/<uuid>/grid.jpg` と `edges/<uuid>/cam/<uuid>/snapshot.jpg` に限定。
  トークンを持っていても任意パスへは書けない。
- 鍵未設定・署名不正・失効・想定外の例外はすべて 403（fail-closed）。

TTL は用途で分ける（monitor 側で設定）:

- **PUT**: 1時間。エッジはキー固定なので URL を使い回し、毎フレームの署名取得は発生しない。
- **GET**: 2分。ブラウザの 302 先。

## セットアップ

1. R2 バケットを作成（Cloudflare ダッシュボード → R2）:

```
edge-images
```

2. 署名鍵を生成し、**Vercel と Worker の両方に同じ値**を設定する:

```bash
openssl rand -hex 32
```

- Vercel: `EDGE_IMAGES_SIGNING_SECRET`（Production）→ Redeploy
- Worker: `wrangler secret put EDGE_IMAGES_SIGNING_SECRET`

3. Vercel に配信元も設定（未設定なら従来の Supabase 経路のまま）:

```
EDGE_IMAGES_BASE_URL = https://img.genesis-edge.com
```

4. デプロイ:

```bash
cd claude/cloudflare/edge-images && npx wrangler deploy
```

5. DNS: `img.genesis-edge.com` を Cloudflare の**プロキシ有効（オレンジ雲）**で作成
   （ルートの `zone_name` と一致させる）。

## 疎通確認

`EDGE_IMAGES_BASE_URL` 設定後、監視画面でライブを数分見て:

- Supabase → Usage の **Egress が増えないこと**
- Cloudflare → R2 → `edge-images` に **オブジェクトが増えること**
- Worker のログ（`npx wrangler tail`）に 403 が出ていないこと

## 費用

Workers 無料枠は 10万リクエスト/日。ライブ視聴は 1〜2 fps なので、常時視聴が増えると
超える。超えたら Workers Paid（$5/月・1,000万リクエスト）へ。**R2 のエグレスは無料**なので、
Supabase の $0.09/GB と違い視聴時間に比例した課金は発生しない。
