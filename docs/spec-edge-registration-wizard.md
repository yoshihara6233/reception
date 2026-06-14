# Spec: 構成別エッジ登録ウィザード（/admin/edges 登録整理）

作成: 2026-06-14 / 対象: `claude/monitor` `/admin/edges` 登録フロー + DB / リポジトリ: yoshihara6233/reception (monitor-prod)
関連計画: [release-plan-v1-ga.md](./release-plan-v1-ga.md)（C2 QR初回登録 / DR2 エンロールトークン / レコーダ管理UI / マルチグリッドティア）

## ⚠️ スコープ改訂（eng-review + Outside Voice 反映・2026-06-14）

eng-review で「本番DB移行2本(deployment_mode 3値移行・NVR一本化)をGA直前に差し込むのはリスク/リターンが逆」と判明。**GAスコープを②relay登録ウィザードに限定**し、重い移行はGA後の別issueへ分離。

**GAに残す（追加のみ・既存破壊なし）**
- `enrollment_tokens` テーブル + `POST /api/edge/enroll`（②relay自己登録）
- ②relay登録ウィザードUI（構成選択は②のみ・ONVIF探索→grid割当→接続テスト）
- `edge_devices.camera_tier`(16/32/48) 列追加 / `recorder_cameras.grid_pos` 0–47 へ制約緩和（前方互換）
- `device_token` は **NOT NULL 維持**（行は登録完了時に作成。nullable化しない）
- enroll硬化（TC4）: ①`used_at` は **enroll成功時のみ**セット（途中失敗で焼かない）/ ②原子UPDATEの WHERE で `token_hash AND tenant_id=$ AND store_id=$ AND used_at IS NULL AND expires_at>now()`（競合＋store_id詐称を同時に封じる）/ ③本部が**期限延長・再発行できるUI**を最低1つ

**GA後へ分離（別issue）**
- `stores.deployment_mode` の3値移行(relay/hq_direct/frigate_unit)＝A1(vendor分離・店別intent)/A2(heartbeatビュー同時更新) … **GAでは既存 `per_store_minipc` のまま②を構築**
- NVR真実源の recorders 一本化(D2)＝A3(消費面 /admin/stores/[id]/nvr・infra/nodes 棚卸し・段階廃止)
- ①hq_direct / ③frigate_unit の enum/列/土台（YAGNI・enum拡張は後付け可能）
- `grid_pos × camera_tier` 整合制約（マルチグリッド32/48 UIと同時。GAは16=0–15のみ）

> 以降の本文（DB一式・D1/D2・①③）は**GA後分離分を含む完全版**。GA実装は上記「GAに残す」のみ。

## Context

拠点構成は3種ある（①本部直結 / ②中継ユニット＝本命 / ③Frigate録画）。しかし現状の登録は「物理エッジ箱を作り `device_token` を現地 `agent.env` に手貼り」という**単一モデル**で、3構成を表現できていない。3構成の情報が `stores` / `edge_devices` / `recorders` に**分散・重複**し、NVR情報は2系統で二重管理。①は `recorders.edge_id NOT NULL` のため箱前提モデルに乗らない。計画で決めた **QR自己登録(C2)・エンロールトークン(DR2)・マルチグリッドティア** も未反映。
1号店GA=②なので、**②の登録を非エンジニアでも一気通貫で完了できる**状態が必要。①③はGA後だが、データモデルの土台だけ今入れて手戻りを防ぐ。

## Current State（実測・2026-06-14）

| テーブル | 構成関連カラム | 役割 | 問題 |
|---|---|---|---|
| `stores` | `deployment_mode` ∈ `per_store_minipc`/`central_aggregator`、`nvr_vendor`/`nvr_model`/`nvr_endpoint`/`nvr_credentials_ref`/`central_node_id` | 拠点種別+NVRライフサイクル | 構成は2値のみ・NVR情報が recorders と二重 |
| `edge_devices` | `store_id`/`name`/`device_token`(NOT NULL UNIQUE)/`status`/`camera_tier`**無し** | 物理中継箱・手動トークン | QR自己登録なし・ティアなし |
| `recorders` | `edge_id`(NOT NULL)/`vendor`(ipro\|uniview\|frigate)/`host`/`username`/`password_enc`/`live_host` | NVR実接続 | ①が乗らない・`live_host`にUI無し(SQL直編集) |
| `recorder_cameras` | `channel`/`grid_pos`(0–15)/`frigate_camera` | ch→グリッド | 16/32/48ティア(0–47)未対応 |

- 登録UI: [admin/edges/new/edge-new-form.tsx](claude/monitor/src/app/admin/edges/new/edge-new-form.tsx) は store+name → `device_token` 発行 → 手貼り指示のみ。[api/admin/edges/route.ts](claude/monitor/src/app/api/admin/edges/route.ts) は `randomBytes(32)` を `device_token` に直挿入。
- 認可は `requireAdmin()`（今セッションで service client 方式に修正済み・[intereco-patterns SKILL.md](.claude/skills/intereco-patterns/SKILL.md) §6）。
- `stores.deployment_mode` はヒートビート間隔ビュー（`20260605_004_heartbeat_override.sql`）が参照。enum移行時はビューも要更新。

## Proposed Change

「**店舗の拠点構成を1つ選ぶ → 構成別ウィザードで一気通貫登録**」に統一。`edge_devices` を全構成共通の実行単位とし、①は本部仮想エッジ行（`device_token` null）。NVR真実源は `recorders` に一本化。

### 確定した設計判断
- **D1**: `stores.deployment_mode` を **3値拡張** (`relay`/`hq_direct`/`frigate_unit`、既存 `per_store_minipc→relay`・`central_aggregator→hq_direct` を移行)。`edge_devices` は全構成で保持（①=本部仮想エッジ・`device_token` nullable）。`recorders.edge_id` は **NOT NULL 維持**。
- **D2**: NVR真実源は **`recorders` に一本化**。`stores.nvr_*` は派生ビュー化/廃止（消費側移行後にdrop）。

### 構成別フロー（ASCII）

```
② relay（GA実装）:
  admin: /admin/edges/new → 構成=relay → store + tier(16/32/48) + name
        → edge_devices行作成 + enrollment_token発行 → QR表示(+トークン文字列)
  現地: ユニット起動 → QR/トークン読取 → POST /api/edge/enroll{token}
        → サーバ検証(単一使用/TTL/tenant・store一致) → device_token払出 + SFU資格
  wizard: NVR接続入力(host/port/creds) → ONVIF自動探索 → ch列挙
        → grid割当(0–47) → recorder+recorder_cameras作成 → 接続テスト(RTSP/snapshot到達) → 緑で完了

① hq_direct（GA後・土台のみ）:
  現地箱なし。store+構成① → 本部→NVR到達手段(VPN/EZCloud/i-PRO P2P)+認証+cameras。
  edge_devices行=本部仮想エッジ(token無し)。enrollment不要。

③ frigate_unit（GA後・土台のみ）:
  ②と同じQRフロー + 録画ストレージ設定(vendor=frigate)。
```

### Implementation Details

**DB マイグレーション（新規 `supabase/migrations/2026MMDD_edge_config_registration.sql`）**

```sql
-- 1. deployment_mode を3値へ（ビュー依存に注意）
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_deployment_mode_check;
UPDATE stores SET deployment_mode='relay'     WHERE deployment_mode='per_store_minipc';
UPDATE stores SET deployment_mode='hq_direct' WHERE deployment_mode='central_aggregator';
ALTER TABLE stores ALTER COLUMN deployment_mode SET DEFAULT 'relay';
ALTER TABLE stores ADD CONSTRAINT stores_deployment_mode_check
  CHECK (deployment_mode IN ('relay','hq_direct','frigate_unit'));
-- ヒートビート間隔ビュー(20260605_004)の per_store_minipc/central_aggregator 分岐を relay/hq_direct に更新（同マイグレーションで CREATE OR REPLACE VIEW）。

-- 2. edge_devices: camera_tier + device_token nullable
ALTER TABLE edge_devices ADD COLUMN IF NOT EXISTS camera_tier int NOT NULL DEFAULT 16
  CHECK (camera_tier IN (16,32,48));
ALTER TABLE edge_devices ALTER COLUMN device_token DROP NOT NULL;
-- device_token: null=未エンロール(or hq_direct)。enroll redeem 時に payout。

-- 3. enrollment_tokens（DR2: 単一使用・短期TTL・tenant/store束縛）
CREATE TABLE enrollment_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,            -- 生トークンは保存しない(SHA-256)
  edge_id      uuid NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL,
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  camera_tier  int  NOT NULL CHECK (camera_tier IN (16,32,48)),
  expires_at   timestamptz NOT NULL,            -- 既定 now()+24h
  used_at      timestamptz,                     -- 単一使用: 非NULLで失効
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_enroll_edge ON enrollment_tokens(edge_id);
ALTER TABLE enrollment_tokens ENABLE ROW LEVEL SECURITY;
-- service client のみ(RLS: 認可はコード側 requireAdmin、enroll redeem は service)

-- 4. grid_pos 0–47（マルチグリッド）
ALTER TABLE recorder_cameras DROP CONSTRAINT IF EXISTS recorder_cameras_grid_pos_check;
ALTER TABLE recorder_cameras ADD CONSTRAINT recorder_cameras_grid_pos_check
  CHECK (grid_pos BETWEEN 0 AND 47);

-- 5. NVR真実源を recorders に（stores.nvr_* は段階廃止）
CREATE OR REPLACE VIEW store_nvr_summary AS
  SELECT e.store_id, r.vendor, r.model, count(*) AS recorder_count
  FROM recorders r JOIN edge_devices e ON e.id = r.edge_id
  GROUP BY e.store_id, r.vendor, r.model;
COMMENT ON COLUMN stores.nvr_vendor IS 'DEPRECATED: use recorders/store_nvr_summary. drop after consumers migrate.';
```

**API**
| エンドポイント | 変更 | 認可 |
|---|---|---|
| `POST /api/admin/edges` | 構成(store.deployment_mode由来)+`camera_tier`受領。relayは生token直挿入をやめ **enrollment_token発行**（生トークン1回返却・hashを保存） | requireAdmin |
| `POST /api/admin/edges/[id]/enrollment` | エンロールトークン再発行（QR用） | requireAdmin |
| `POST /api/edge/enroll` | **公開・トークン認証**。`{token}`検証(hash一致/未使用/未失効/tenant・store整合)→`used_at`刻印→`device_token`払出+SFU資格返却。冪等(同tokenの再POSTは同edge資格 or 既使用拒否) | token only(service) |
| `POST /api/admin/recorders/[id]/discover` | ONVIF探索→ch列挙（現地到達はedge経由 or 本部VPN[①]） | requireAdmin |
| `POST/PUT /api/admin/recorders` `…/cameras` | recorder+camera CRUD・`grid_pos 0–47`・`live_host`編集 | requireAdmin |

**UI**（`claude/monitor/src/app/admin/edges/`）
- `/admin/edges/new`: 構成選択ステップ追加（relay有効・hq_direct/frigate_unit はGA後で `disabled`+「GA後」ラベル）。
- relayウィザード: store+tier+name → QR表示(`qrcode.react`既存利用)+トークン → エンロール待ち(ポーリング/realtime) → NVR接続+ONVIF探索→grid割当→接続テスト→完了。
- レコーダ管理UI統合: `live_host`編集・camera/grid_pos編集（SQL直編集撤廃）。

## Acceptance Criteria

1. `stores.deployment_mode` が `relay`/`hq_direct`/`frigate_unit` の3値で、既存データが正しく移行（`per_store_minipc→relay`, `central_aggregator→hq_direct`）、ヒートビート間隔ビューが新値で動作（旧値参照ゼロ）。
2. **② relay**: 管理者が store+tier+name を登録すると enrollment_token とQRが発行され、生トークンは画面に1回だけ表示、DBには hash のみ保存。
3. `POST /api/edge/enroll` は (a) 正しい未使用トークンで `device_token`+SFU資格を払出し `used_at` を刻印、(b) 使用済/失効/別tenant・store のトークンを **403で拒否**、(c) 同トークン二重POSTで二重登録しない（冪等）。
4. NVR接続入力後 ONVIF探索でチャンネルが列挙され、`grid_pos` を **0–47** で割当・保存できる。
5. レコーダ管理UIで `live_host` を編集でき、SQL直編集が不要（監査ログ記録）。
6. **①③**: `deployment_mode` に `hq_direct`/`frigate_unit` が選べる（DBは受理）。UIは「GA後」で無効表示（フルウィザードは未実装＝意図通り）。
7. NVR情報の読み取りが `recorders`/`store_nvr_summary` 由来になり、`stores.nvr_*` への新規書き込みがゼロ。
8. ロール別/テナント越権不可（authz契約テスト緑）。テスト全層追加・既存機能の劣化なし。

## Testing Plan

| 層 | 内容 | 数 |
|---|---|---|
| Unit | enrollトークン: hash/TTL/単一使用/tenant整合の検証分岐、grid_pos境界(0/47/48) | +6 |
| 統合(実DB) | enroll redeem 正常/使用済/失効/別tenant、deployment_mode移行、NVR真実源読取 | +5 |
| 契約(authz) | relay登録/enrollを各ロール×テナントで可視・不可視（DR1行列に追加） | +3 |
| E2E | 構成選択→relay登録→QR→(モックedge)enroll→ONVIF探索(モック)→grid割当→完了 | +1 |

## Rollback Plan

- DBは新マイグレーション。問題時は逆マイグレーション（deployment_mode を2値へ戻す逆UPDATE+制約、enrollment_tokens drop、grid_pos 0–15へ戻す＝0–15超データが無い前提で安全）。`stores.nvr_*` は drop しない段階廃止なので読み戻し可能。
- monitor は Vercel ロールバック。enroll API は新規エンドポイントなので無効化で旧手動token手貼りに戻せる（移行期は併存可）。

## Effort Estimate

- DBマイグレーション（3値移行+ビュー更新+enrollment_tokens+grid_pos+NVRビュー）: 人 ~1.5d / CC ~2h
- enroll API（発行/redeem・冪等・トークンhash・セキュリティ）: 人 ~2d / CC ~3h
- ONVIF探索+recorder/camera/grid UI + live_host編集: 人 ~3d / CC ~0.5d
- 構成選択+relayウィザードUI(QR/エンロール待ち): 人 ~3d / CC ~0.5d
- テスト全層: 人 ~2d / CC ~3h
- 合計: 人 ~11.5d / CC ~1.5d（②のみ。①③フルウィザードは別issue）

## Files Reference

| ファイル | 変更 |
|---|---|
| `supabase/migrations/2026MMDD_edge_config_registration.sql` | 新規（上記DB一式） |
| `supabase/migrations/20260605_004_heartbeat_override.sql` 由来ビュー | deployment_mode 新値へ CREATE OR REPLACE |
| `claude/monitor/src/app/api/admin/edges/route.ts` | enrollment_token発行へ変更 |
| `claude/monitor/src/app/api/admin/edges/[id]/enrollment/route.ts` | 新規（再発行） |
| `claude/monitor/src/app/api/edge/enroll/route.ts` | 新規（自己登録・token認証） |
| `claude/monitor/src/app/api/admin/recorders/**` | discover/CRUD・grid_pos 0–47・live_host |
| `claude/monitor/src/app/admin/edges/new/edge-new-form.tsx` | 構成選択+relayウィザード化 |
| `claude/edge-agent/**` | 初回ブートでQR/token読取→enroll呼び出し |

## Out of Scope

- ① hq_direct / ③ frigate_unit の**フルウィザードUI**（GA後・別issue。本issueは enum/列/テーブルの土台のみ）。
- 本部仮想エッジ(①)のランタイム実装（本部側でNVR直結中継を実行する処理）。
- 代理店(dealer)向け配布フロー・事前イメージ・承認機種調達（別issue）。
- ティア課金の集計/請求（camera_tier列は入れるが課金は別）。
- SFU(LiveKit) publish 本実装（別track）。

## Related

- 計画: [release-plan-v1-ga.md](./release-plan-v1-ga.md) C2/DR2/レコーダ管理UI/マルチグリッドティア
- 構成3種: [edge-configs-and-relay-hardware.md](./edge-configs-and-relay-hardware.md)
- 知見: [.claude/skills/intereco-patterns/SKILL.md](../.claude/skills/intereco-patterns/SKILL.md)
