-- 発報前後スナップ（Phase B / PB7）— alarm_frames
--
-- 1 発報につき「店舗の全カメラ × 8 オフセット」の JPEG を録画から抽出して保存する
-- （BCP の 8 枚タイムラインを秒粒度・発報単位に再構成したもの）。
--   オフセット秒: -5, 0, +5, +10, +20, +30, +60, +180（発生時=0）
--   保存先:      security-snapshots/alarms/<alarm_event_id>/frames/<camera_id>/<key>.jpg
--
-- RLS は親 alarm_events の可視性を継承（同一 store scope）。
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS。

CREATE TABLE IF NOT EXISTS alarm_frames (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  alarm_event_id uuid        NOT NULL REFERENCES alarm_events(id) ON DELETE CASCADE,
  camera_id      uuid        REFERENCES recorder_cameras(id),
  offset_sec     int         NOT NULL,                       -- -5,0,5,10,20,30,60,180
  storage_path   text,                                       -- security-snapshots 内パス
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','completed','failed')),
  source         text,                                       -- frigate-recording|ipro-nvr-recording|latest|...
  captured_at    timestamptz,                                -- 実撮影(抽出)時刻
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alarm_event_id, camera_id, offset_sec)
);
CREATE INDEX IF NOT EXISTS idx_alarm_frames_event ON alarm_frames(alarm_event_id);

-- ---------------------------------------------------------------------------
-- RLS（親 alarm_events の store scope を継承）
-- ---------------------------------------------------------------------------
ALTER TABLE alarm_frames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alarm_frames_select" ON alarm_frames;
CREATE POLICY "alarm_frames_select" ON alarm_frames
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM alarm_events e
      JOIN admin_users u ON u.auth_user_id = auth.uid()
      WHERE e.id = alarm_frames.alarm_event_id
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = e.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()
                ))
                OR e.store_id = ANY(u.store_ids)
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS "alarm_frames_modify" ON alarm_frames;
CREATE POLICY "alarm_frames_modify" ON alarm_frames
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );
