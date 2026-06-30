-- 自律OTA + known-good ロールバック（Phase C）— edge_devices 列追加
--
-- クラウドが desired 版を宣言し、エッジが /api/edge/bootstrap の pull で受信して
-- 自己更新する（docs/edge-ota-design.md）。エッジは heartbeat で現行版/OTA状態を報告する。
--
--   desired_* … 本部が宣言する目標版（NULL=更新指示なし）。per-device＝カナリア。
--   agent_version(既存) / cloudflared_version … エッジが報告する現行版。
--   ota_status / ota_updated_at / ota_last_error … エッジが報告する最新OTA状況。
--
-- Idempotent: ADD COLUMN IF NOT EXISTS。RLS は既存方針のまま（列追加のみ・ポリシー不変）。

ALTER TABLE edge_devices
  ADD COLUMN IF NOT EXISTS cloudflared_version         text,
  ADD COLUMN IF NOT EXISTS desired_agent_version       text,
  ADD COLUMN IF NOT EXISTS desired_cloudflared_version text,
  ADD COLUMN IF NOT EXISTS ota_status                  text,
  ADD COLUMN IF NOT EXISTS ota_updated_at              timestamptz,
  ADD COLUMN IF NOT EXISTS ota_last_error              text;

COMMENT ON COLUMN edge_devices.desired_agent_version       IS '本部が宣言するエージェント目標版(git short sha)。NULL=更新指示なし。per-device=カナリア。';
COMMENT ON COLUMN edge_devices.desired_cloudflared_version IS '本部が宣言する cloudflared 目標版。NULL=更新指示なし。';
COMMENT ON COLUMN edge_devices.cloudflared_version         IS 'エッジが報告する現行 cloudflared 版。';
COMMENT ON COLUMN edge_devices.ota_status                  IS 'エッジ報告のOTA状況: idle|updating|pending_verify|healthy|rolled_back。';
