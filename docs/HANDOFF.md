# レコーダ監視システム — 実装ハンドオフ

v2.0 仕様（10,000 店舗・1日2時間モニタリング・オンデマンド方式）の **Phase 0〜2 相当**を初期実装した状態。

## 何ができているか

### Phase 0 — プロジェクト立上げ
- `claude/monitor/`（本部 Next.js アプリ、ポート 3100）
- `claude/edge-agent/`（現地 Node.js エージェント）
- それぞれ `package.json` / `tsconfig.json` / `.env.example` 完備

### Phase 1 — DB マイグレーション
- [claude/monitor/supabase/migrations/20260519_001_recorder_monitoring.sql](../claude/monitor/supabase/migrations/20260519_001_recorder_monitoring.sql)
  - `stores.latitude / longitude / area_code / geocoded_at`
  - `edge_devices`, `recorders`, `recorder_cameras`
  - `live_sessions`（月次パーティション）
  - `session_limits`（1日120分の上限）
  - RLS ポリシー（reception 既存 admin_users.role に準拠）
  - `daily_session_minutes(p_user_id)` ヘルパ関数

### 本部 UI（monitor）
- `/login` Supabase Auth ログイン
- `/map` Leaflet+OSM、店舗マーカークラスタ、ステータス色分け
- `/stores/[id]` 16分割 JPEG ビュー（オンデマンド `start_grid` / `stop_grid`）
- `/stores/[id]/cam/[cameraId]/live` LiveKit WebRTC 視聴
- `/api/edges/[id]/commands` コマンド配信（Realtime broadcast）
- `/api/livekit/token` 短期 5 分トークン発行

### エッジエージェント（edge-agent）
- 状態機械（Idle / Grid / Live / VOD）
- Supabase Realtime コマンド受信
- ffmpeg xstack による 16分割 JPEG 合成
- ffmpeg WHIP による LiveKit 単一カメラ publish
- Uniview replay URL の VOD publish
- 60 秒間隔ハートビート
- systemd ユニット（`systemd/edge-agent.service`）

## まだ実装していない（Phase 3 以降）

| Phase | 内容 |
|---|---|
| 3 | エッジから Storage への JPEG アップロードの実機検証、`edge-grids` バケットの作成と RLS |
| 5 | 管理 UI（店舗・カメラ・エッジ・テナント・ユーザの CRUD、CSV 一括投入） |
| 6 | LiveKit Cloud の Ingress 設定、エッジ→WHIP 経路の実機検証 |
| 7 | VOD UI（シークバー、from/to ピッカー） |
| 8 | i-PRO NVR の ONVIF Profile-G 実装（`src/onvif/` を新設、`onvif` パッケージ等） |
| 9 | セッション上限の強制ロジック（`daily_session_minutes` を使った 2h 制限） |
| 10 | カナリア OTA、journald → クラウドログ転送、配布 SD イメージ |
| 11 | 10,000 エッジ模擬・LiveKit 100 同時視聴の負荷試験 |
| 12 | 結合・現地検証・運用 SOP |

## 次の作業着手手順

1. **Supabase プロジェクトの準備**
   - 既存 reception と同じ Supabase に migration を適用
   - Storage バケット `edge-grids`（private）を作成
   - service_role でのみ書ける RLS ポリシーを追加

2. **LiveKit Cloud のセットアップ**
   - プロジェクト作成、`LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` を `.env.local` に
   - Ingress (WHIP) を有効化

3. **monitor 起動確認**
   ```bash
   cd claude/monitor
   cp .env.example .env.local && vi .env.local
   npm install && npm run dev
   ```
   `/login` → ログイン → `/map` で地図描画。

4. **エッジ起動確認（開発機で）**
   ```bash
   cd claude/edge-agent
   cp .env.example .env && vi .env  # EDGE_ID / EDGE_DEVICE_TOKEN を仮で設定
   npm install
   npm run dev
   ```
   `edge_devices` テーブルにレコードを 1 件挿入し、UI から `start_grid` を発火。

5. **i-PRO / Uniview 実機検証**
   - `recorders` / `recorder_cameras` にレコード投入
   - 16分割が出る → 単一ライブが出る → Uniview VOD が出る の順で確認

## 既知の TODO / 注意点

- `recorders.password_enc` は現状プレーンテキスト前提。**Phase 9 で Supabase Vault に置き換える**こと。
- LiveKit WHIP の URL パターンは `wss://...` → `https://.../rtc/whip?...` という管理サービスの命名規則に依存。**Phase 6 で実機確認**が必要。
- `react-leaflet-cluster` の型は緩いため、`stores` を `as never` 経由で渡している。**Phase 5 で zod スキーマ化**するか型ファイルを整備する。
- `live_sessions` の自動パーティション作成は今のところ 2 か月先までブートストラップしているのみ。**月次バッチ**で先回り作成すること。
