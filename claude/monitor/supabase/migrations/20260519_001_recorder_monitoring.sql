-- Recorder Monitoring System (i-PRO / Uniview) - Phase 1
-- - Adds geo coordinates and area_code to existing stores
-- - Adds edge_devices, recorders, recorder_cameras, live_sessions, session_limits
-- - Enables RLS on all new tables; policies follow reception conventions:
--     * super_admin     : all rows
--     * tenant_admin    : rows in tenant
--     * store_manager   : rows where store_id IN admin_users.store_ids
--     * viewer          : read-only on same scope as store_manager
--
-- Idempotent (uses IF NOT EXISTS where supported). Designed for the standalone
-- monitor app but lives next to reception in the same Supabase project so
-- stores/tenants/admin_users remain the source of truth.

-- ---------------------------------------------------------------------------
-- 0. Required extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. stores : geo coordinates and area for map view
-- ---------------------------------------------------------------------------
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS latitude     numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude    numeric(9,6),
  ADD COLUMN IF NOT EXISTS area_code    text,
  ADD COLUMN IF NOT EXISTS geocoded_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_stores_area ON stores(area_code);
CREATE INDEX IF NOT EXISTS idx_stores_geo
  ON stores USING gist (ll_to_earth(latitude, longitude))
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. edge_devices : on-site mini-PCs that bridge recorders to the cloud
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edge_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name           text NOT NULL,
  device_token   text NOT NULL UNIQUE,
  agent_version  text,
  status         text NOT NULL DEFAULT 'offline'
                 CHECK (status IN ('offline','idle','grid','live','vod','error')),
  current_mode   text,
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edges_store  ON edge_devices(store_id);
CREATE INDEX IF NOT EXISTS idx_edges_status ON edge_devices(status);

-- updated_at auto-touch
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_edges_updated_at ON edge_devices;
CREATE TRIGGER trg_edges_updated_at
  BEFORE UPDATE ON edge_devices
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. recorders : the actual NVR / camera-direct endpoint
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recorders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_id       uuid NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  vendor        text NOT NULL CHECK (vendor IN ('ipro','uniview')),
  model         text,
  host          text NOT NULL,
  rtsp_port     int  NOT NULL DEFAULT 554,
  onvif_port    int,
  username      text NOT NULL,
  password_enc  text NOT NULL,                       -- Supabase Vault reference
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recorders_edge ON recorders(edge_id);

DROP TRIGGER IF EXISTS trg_recorders_updated_at ON recorders;
CREATE TRIGGER trg_recorders_updated_at
  BEFORE UPDATE ON recorders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. recorder_cameras : per-channel metadata, 16-cell grid layout
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recorder_cameras (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorder_id  uuid NOT NULL REFERENCES recorders(id) ON DELETE CASCADE,
  channel      int  NOT NULL CHECK (channel BETWEEN 1 AND 64),
  name         text NOT NULL,
  grid_pos     int  NOT NULL CHECK (grid_pos BETWEEN 0 AND 15),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recorder_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_cameras_recorder ON recorder_cameras(recorder_id);

-- ---------------------------------------------------------------------------
-- 5. live_sessions : audit log + live session limit tracking
--    Partitioned by month for retention/perf at 10k-store scale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_sessions (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  store_id      uuid NOT NULL,
  camera_id     uuid,
  mode          text NOT NULL CHECK (mode IN ('grid','live','vod')),
  livekit_room  text,
  vod_from      timestamptz,
  vod_to        timestamptz,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  duration_sec  int,
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);

-- Bootstrap partitions for current and next month
DO $$
DECLARE
  m_start  date := date_trunc('month', now())::date;
  m_next   date := (date_trunc('month', now()) + interval '1 month')::date;
  m_after  date := (date_trunc('month', now()) + interval '2 month')::date;
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS live_sessions_%s PARTITION OF live_sessions FOR VALUES FROM (%L) TO (%L);',
    to_char(m_start, 'YYYYMM'), m_start, m_next
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS live_sessions_%s PARTITION OF live_sessions FOR VALUES FROM (%L) TO (%L);',
    to_char(m_next, 'YYYYMM'), m_next, m_after
  );
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_user_started
  ON live_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_store_started
  ON live_sessions(store_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- 6. session_limits : per-tenant viewing quota (F-10)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_limits (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  max_concurrent  int NOT NULL DEFAULT 5,
  max_daily_min   int NOT NULL DEFAULT 120,             -- 1日2時間
  idle_timeout_s  int NOT NULL DEFAULT 300,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_limits_updated_at ON session_limits;
CREATE TRIGGER trg_limits_updated_at
  BEFORE UPDATE ON session_limits
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. RLS policies (mirror reception conventions)
-- ---------------------------------------------------------------------------
ALTER TABLE edge_devices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE recorders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE recorder_cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_limits   ENABLE ROW LEVEL SECURITY;

-- edge_devices: visible if the admin can access the store
DROP POLICY IF EXISTS "edges_select" ON edge_devices;
CREATE POLICY "edges_select" ON edge_devices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (SELECT 1 FROM stores s
                     WHERE s.id = edge_devices.store_id
                       AND (u.role = 'tenant_admin' AND s.tenant_id IN (
                              SELECT tenant_id FROM admin_users WHERE id = auth.uid()
                            ))
                          OR edge_devices.store_id = ANY(u.store_ids)
                    )
        )
    )
  );

DROP POLICY IF EXISTS "edges_modify" ON edge_devices;
CREATE POLICY "edges_modify" ON edge_devices
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- recorders: piggy-back on edge_devices
DROP POLICY IF EXISTS "recorders_select" ON recorders;
CREATE POLICY "recorders_select" ON recorders
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM edge_devices e WHERE e.id = recorders.edge_id)
  );

DROP POLICY IF EXISTS "recorders_modify" ON recorders;
CREATE POLICY "recorders_modify" ON recorders
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- recorder_cameras
DROP POLICY IF EXISTS "cameras_select" ON recorder_cameras;
CREATE POLICY "cameras_select" ON recorder_cameras
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM recorders r WHERE r.id = recorder_cameras.recorder_id)
  );

DROP POLICY IF EXISTS "cameras_modify" ON recorder_cameras;
CREATE POLICY "cameras_modify" ON recorder_cameras
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- live_sessions: users can see their own sessions; tenant_admin sees tenant; super_admin all
DROP POLICY IF EXISTS "sessions_select" ON live_sessions;
CREATE POLICY "sessions_select" ON live_sessions
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin')
    )
  );

DROP POLICY IF EXISTS "sessions_insert" ON live_sessions;
CREATE POLICY "sessions_insert" ON live_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- session_limits: admins manage
DROP POLICY IF EXISTS "limits_select" ON session_limits;
CREATE POLICY "limits_select" ON session_limits
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND (u.role = 'super_admin' OR u.tenant_id = session_limits.tenant_id)
    )
  );

DROP POLICY IF EXISTS "limits_modify" ON session_limits;
CREATE POLICY "limits_modify" ON session_limits
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Helper: current daily quota usage for a user (F-10 enforcement)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION daily_session_minutes(p_user_id uuid)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    SUM(
      EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)) / 60
    )::int,
    0
  )
  FROM live_sessions
  WHERE user_id = p_user_id
    AND started_at >= date_trunc('day', now())
$$;
