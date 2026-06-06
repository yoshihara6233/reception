# monitor

i-PRO / Uniview レコーダ統合監視 — 本部ウェブアプリ（Next.js 16）

## 構成

| パス | 役割 |
|---|---|
| `src/app/map/` | Leaflet+OSM の店舗マップ。マーカークリック→店舗詳細 |
| `src/app/stores/[id]/` | 16分割 JPEG ビューア（オンデマンドで Grid モード開始） |
| `src/app/stores/[id]/cam/[cameraId]/live/` | LiveKit WebRTC 単一カメラライブ |
| `src/app/api/edges/[id]/commands/` | エッジへの制御コマンド送信（Supabase Realtime 経由） |
| `src/app/api/livekit/token/` | LiveKit 短期トークン発行（参加者・publisher） |
| `src/lib/edge/commands.ts` | エッジエージェントと共有するコマンド契約 |
| `supabase/migrations/` | DB マイグレーション（Phase 1） |

## 起動

```bash
cp .env.example .env.local
# .env.local を編集して Supabase / LiveKit のシークレットを設定
npm install
npm run dev   # http://localhost:3100
```

## マイグレーション適用

`supabase/migrations/20260519_001_recorder_monitoring.sql` を Supabase プロジェクトに適用。
既存の reception プロジェクトと **同じ Supabase に共存** する想定（stores / tenants / admin_users を共有）。

## Storage バケット

`edge-grids` というプライベートバケットを作成し、エッジが
`edges/{edge_id}/grid.jpg` を上書き PUT する。本部 UI はサイン URL（60秒）で取得。

## オンデマンド方式

10,000 店舗対応のため、エッジは **平常時 Idle**。
本部 UI で監視を開始すると `start_grid` / `start_live` / `start_vod` を Realtime で配信し、
画面離脱時に `stop_grid` / `stop_stream` で停止する。
