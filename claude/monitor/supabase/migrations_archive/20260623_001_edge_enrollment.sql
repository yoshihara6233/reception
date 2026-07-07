-- ②relay エッジ登録ウィザードの DB 基盤（Phase B / GAスコープ・追加のみ／破壊的移行なし）。
-- spec: docs/spec-edge-registration-wizard.md（改訂版「GAに残す」）。
-- deployment_mode 3値移行・NVR一本化は GA後の別issue（ここではやらない）。

-- 1. camera_tier（マルチグリッド 16/32/48・課金ティアの素地）。既定16。
ALTER TABLE edge_devices
  ADD COLUMN IF NOT EXISTS camera_tier int NOT NULL DEFAULT 16
  CHECK (camera_tier IN (16, 32, 48));

-- 2. grid_pos を 0–47 へ前方互換緩和（UI は当面 0–15 のみ使用）。
ALTER TABLE recorder_cameras DROP CONSTRAINT IF EXISTS recorder_cameras_grid_pos_check;
ALTER TABLE recorder_cameras
  ADD CONSTRAINT recorder_cameras_grid_pos_check CHECK (grid_pos BETWEEN 0 AND 47);

-- 3. enrollment_tokens（DR2: 単一使用・短期TTL・tenant/store束縛）。
--    エッジ行は enroll 完了時に作成するため、発行時点では edge_id は NULL。
--    生トークンは保存せず SHA-256 ハッシュのみ保持。
CREATE TABLE IF NOT EXISTS enrollment_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,                 -- SHA-256(生トークン)
  store_id     uuid NOT NULL REFERENCES stores(id)        ON DELETE CASCADE,
  tenant_id    uuid NOT NULL,                         -- store 由来（詐称防止のため client 入力ではない）
  name         text NOT NULL,                         -- 登録予定のエッジ名
  camera_tier  int  NOT NULL DEFAULT 16 CHECK (camera_tier IN (16, 32, 48)),
  edge_id      uuid REFERENCES edge_devices(id)       ON DELETE SET NULL,  -- redeem 成功時にセット
  expires_at   timestamptz NOT NULL,                  -- 既定 now()+24h（発行時にアプリが設定）
  used_at      timestamptz,                           -- 単一使用: 非NULLで失効
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_store ON enrollment_tokens(store_id);

-- RLS 有効・ポリシー無し ＝ service_role のみアクセス可。
--   admin の発行/状態/再発行は requireAdmin() 認可後に service client、
--   redeem(/api/edge/enroll) は公開・トークン認証で service client。
--   → authenticated セッションからは一切読めない（トークン漏洩面を作らない）。
ALTER TABLE enrollment_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE enrollment_tokens IS
  'エッジ自己登録トークン(単一使用/TTL/tenant・store束縛)。RLSポリシー無し=service_roleのみ。';
