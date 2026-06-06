-- Frigate VMS (OSS-VMS) vendor support
-- - Adds 'frigate' to recorders.vendor CHECK constraint
-- - Adds per-camera frigate_camera column to recorder_cameras
-- - Updates default RTSP port hint (informational; port is per-row)

-- ---------------------------------------------------------------------------
-- 1. recorders: allow vendor = 'frigate'
-- ---------------------------------------------------------------------------
ALTER TABLE recorders DROP CONSTRAINT IF EXISTS recorders_vendor_check;
ALTER TABLE recorders ADD CONSTRAINT recorders_vendor_check
  CHECK (vendor IN ('ipro','uniview','frigate'));

-- ---------------------------------------------------------------------------
-- 2. recorder_cameras: optional Frigate camera name override
--    e.g. "camera_01", "entrance_cam"
--    If NULL, edge-agent falls back to camera_{channel:02d}
-- ---------------------------------------------------------------------------
ALTER TABLE recorder_cameras
  ADD COLUMN IF NOT EXISTS frigate_camera text;

COMMENT ON COLUMN recorder_cameras.frigate_camera IS
  'Frigate re-stream name (e.g. "camera_01"). Required when recorder.vendor=''frigate''. '
  'If NULL, edge-agent derives name from channel number.';
