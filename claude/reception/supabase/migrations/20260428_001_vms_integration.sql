-- VMS (Video Management System) integration
-- Adds VMS fields to baggage_declarations and store_cameras

-- baggage_declarations: store VMS inspection reference
ALTER TABLE baggage_declarations
  ADD COLUMN IF NOT EXISTS vms_inspection_id   TEXT,
  ADD COLUMN IF NOT EXISTS vms_hls_url          TEXT,
  ADD COLUMN IF NOT EXISTS inspection_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_ended_at   TIMESTAMPTZ;

-- store_cameras: add VMS camera ID alongside i-PRO camera ID
ALTER TABLE store_cameras
  ADD COLUMN IF NOT EXISTS vms_camera_id TEXT;

-- stores: add VMS connection settings to the settings JSONB
-- No schema change needed — settings JSONB already handles arbitrary keys.
-- Supported keys:
--   settings.vms_url        TEXT   e.g. "http://192.168.1.100:8080"
--   settings.vms_api_key    TEXT   Bearer token
--   settings.vms_enabled    BOOL   true/false
