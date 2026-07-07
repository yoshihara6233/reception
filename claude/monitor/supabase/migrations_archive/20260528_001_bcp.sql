-- BCP (Business Continuity Plan) J-Alert Feature
-- - Adds pending_command columns to edge_devices (they exist in prod but were missing from migrations)
-- - Adds 'bcp' to edge_devices.status CHECK constraint
-- - Creates bcp_events, bcp_clips, bcp_reports, bcp_settings
-- - Enables RLS on all 4 new tables following the same pattern as
--   20260519_001_recorder_monitoring.sql
-- - Adds a trigger to auto-update bcp_events.status when all clips reach terminal state
--
-- Idempotent: uses IF NOT EXISTS / DROP ... IF EXISTS throughout.

-- ---------------------------------------------------------------------------
-- 1. edge_devices : add pending_command columns (exist in prod, backfill migration)
-- ---------------------------------------------------------------------------
ALTER TABLE edge_devices
  ADD COLUMN IF NOT EXISTS pending_command     jsonb,
  ADD COLUMN IF NOT EXISTS pending_command_at  timestamptz;

-- ---------------------------------------------------------------------------
-- 2. edge_devices : add 'bcp' to status CHECK constraint
--    Drop the old constraint by name, recreate with extended value list.
--    Constraint name matches what was created in 20260519_001_recorder_monitoring.sql.
-- ---------------------------------------------------------------------------
ALTER TABLE edge_devices
  DROP CONSTRAINT IF EXISTS edge_devices_status_check;

ALTER TABLE edge_devices
  ADD CONSTRAINT edge_devices_status_check
    CHECK (status IN ('offline','idle','grid','live','vod','error','bcp'));

-- ---------------------------------------------------------------------------
-- 3. bcp_events : one row per J-Alert or manual-test trigger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bcp_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         uuid        REFERENCES stores(id),
  alert_source     text,                                          -- 'jalert' | 'manual_test'
  alert_type       text,                                          -- 'missile' | 'earthquake' | 'tsunami' | 'test'
  alert_issued_at  timestamptz NOT NULL,
  area_code        text,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN (
                                 'pending','recording','clips_uploaded',
                                 'report_generated','completed','failed'
                               )),
  is_test          boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bcp_events_store  ON bcp_events(store_id);
CREATE INDEX IF NOT EXISTS idx_bcp_events_status ON bcp_events(status);

-- ---------------------------------------------------------------------------
-- 4. bcp_clips : one row per camera clip per BCP event
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bcp_clips (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid        REFERENCES bcp_events(id),
  camera_id      uuid        REFERENCES recorder_cameras(id),   -- NOTE: recorder_cameras not cameras
  clip_from      timestamptz NOT NULL,
  clip_to        timestamptz NOT NULL,
  clip_url       text,
  thumbnail_url  text,
  duration_sec   int,
  upload_status  text        NOT NULL DEFAULT 'pending'
                             CHECK (upload_status IN (
                               'pending','uploading','completed','failed','skipped_ipro'
                             )),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bcp_clips_event ON bcp_clips(event_id);

-- ---------------------------------------------------------------------------
-- 5. bcp_reports : generated PDF reports for a BCP event
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bcp_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid        REFERENCES bcp_events(id),
  pdf_url        text,
  generated_at   timestamptz,
  sent_to_emails text[],
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 6. bcp_settings : per-store BCP configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bcp_settings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid        UNIQUE REFERENCES stores(id),
  pre_minutes    int         NOT NULL DEFAULT 3  CHECK (pre_minutes  BETWEEN 1 AND 10),
  post_minutes   int         NOT NULL DEFAULT 5  CHECK (post_minutes BETWEEN 1 AND 30),
  notify_emails  text[],
  enabled        boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bcp_settings_store ON bcp_settings(store_id);

-- updated_at auto-touch for bcp_settings
DROP TRIGGER IF EXISTS trg_bcp_settings_updated_at ON bcp_settings;
CREATE TRIGGER trg_bcp_settings_updated_at
  BEFORE UPDATE ON bcp_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Trigger: auto-advance bcp_events.status → 'clips_uploaded'
--    when ALL clips for the event have reached a terminal state
--    (completed / failed / skipped_ipro) and the event is not already
--    in a terminal state (failed / completed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bcp_check_clips_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pending_count int;
  v_event_status  text;
BEGIN
  -- Only act when upload_status actually changed
  IF TG_OP = 'UPDATE' AND OLD.upload_status = NEW.upload_status THEN
    RETURN NEW;
  END IF;

  -- Check if any clip for this event is still in a non-terminal state
  SELECT COUNT(*)
    INTO v_pending_count
    FROM bcp_clips
   WHERE event_id = NEW.event_id
     AND upload_status NOT IN ('completed','failed','skipped_ipro');

  IF v_pending_count = 0 THEN
    SELECT status INTO v_event_status FROM bcp_events WHERE id = NEW.event_id;

    -- Only advance if not already in a terminal state
    IF v_event_status NOT IN ('failed','completed') THEN
      UPDATE bcp_events
         SET status = 'clips_uploaded'
       WHERE id = NEW.event_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bcp_clips_complete ON bcp_clips;
CREATE TRIGGER trg_bcp_clips_complete
  AFTER INSERT OR UPDATE ON bcp_clips
  FOR EACH ROW EXECUTE FUNCTION bcp_check_clips_complete();

-- ---------------------------------------------------------------------------
-- 8. RLS — enable on all 4 new tables
-- ---------------------------------------------------------------------------
ALTER TABLE bcp_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bcp_clips    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bcp_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bcp_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- bcp_events policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bcp_events_select" ON bcp_events;
CREATE POLICY "bcp_events_select" ON bcp_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = bcp_events.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE id = auth.uid()
                ))
                OR bcp_events.store_id = ANY(u.store_ids)
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS "bcp_events_modify" ON bcp_events;
CREATE POLICY "bcp_events_modify" ON bcp_events
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- bcp_clips policies (piggy-back on bcp_events)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bcp_clips_select" ON bcp_clips;
CREATE POLICY "bcp_clips_select" ON bcp_clips
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM bcp_events e WHERE e.id = bcp_clips.event_id)
  );

DROP POLICY IF EXISTS "bcp_clips_modify" ON bcp_clips;
CREATE POLICY "bcp_clips_modify" ON bcp_clips
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- bcp_reports policies (piggy-back on bcp_events)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bcp_reports_select" ON bcp_reports;
CREATE POLICY "bcp_reports_select" ON bcp_reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM bcp_events e WHERE e.id = bcp_reports.event_id)
  );

DROP POLICY IF EXISTS "bcp_reports_modify" ON bcp_reports;
CREATE POLICY "bcp_reports_modify" ON bcp_reports
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- bcp_settings policies (store-scoped, same pattern as edge_devices)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bcp_settings_select" ON bcp_settings;
CREATE POLICY "bcp_settings_select" ON bcp_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = bcp_settings.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE id = auth.uid()
                ))
                OR bcp_settings.store_id = ANY(u.store_ids)
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS "bcp_settings_modify" ON bcp_settings;
CREATE POLICY "bcp_settings_modify" ON bcp_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );
