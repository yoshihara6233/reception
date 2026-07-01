-- 発報連携（Phase B）— alarm_settings / alarm_events
--
-- 巡回（patrol_*）が「定時の証跡」なのに対し、発報はイベント駆動でリアルタイム。
-- 源（ONVIF Event / Frigate MQTT / i-PRO / Webhook）から発報を受け、記録・通知する。
-- スナップは既存 security-snapshots バケットを流用（alarms/<eventId>.jpg）。
--
-- RLS は security 系（20260529_002_security.sql）と同一パターン（auth_user_id 使用）。
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS。

-- edge_devices.status に 'alarm' を追加（発報撮影中の状態・任意利用）
ALTER TABLE edge_devices DROP CONSTRAINT IF EXISTS edge_devices_status_check;
ALTER TABLE edge_devices
  ADD CONSTRAINT edge_devices_status_check
    CHECK (status IN ('offline','idle','grid','live','vod','error','bcp','security','alarm'));

-- ---------------------------------------------------------------------------
-- 1. alarm_settings : 店舗別 発報設定
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alarm_settings (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           uuid        UNIQUE REFERENCES stores(id),
  enabled            boolean     NOT NULL DEFAULT false,
  sources            text[]      NOT NULL DEFAULT '{}',           -- onvif|frigate|ipro|webhook
  event_types        text[]      NOT NULL DEFAULT '{}',           -- 空=全種別。motion|tamper|input 等
  debounce_sec       int         NOT NULL DEFAULT 30  CHECK (debounce_sec >= 0),   -- 撮影の集約窓
  dedup_window_sec   int         NOT NULL DEFAULT 120 CHECK (dedup_window_sec >= 0),-- 通知の重複排除窓
  quiet_from         text,                                        -- HH:MM 静音開始（null=なし）
  quiet_to           text,                                        -- HH:MM 静音終了
  notify_emails      text[],
  notify_webhook_url text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alarm_settings_store ON alarm_settings(store_id);

DROP TRIGGER IF EXISTS trg_alarm_settings_updated_at ON alarm_settings;
CREATE TRIGGER trg_alarm_settings_updated_at
  BEFORE UPDATE ON alarm_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. alarm_events : 発報 1 件＝1 行
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alarm_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid        REFERENCES stores(id),
  camera_id    uuid        REFERENCES recorder_cameras(id),
  source       text        NOT NULL,                              -- onvif|frigate|ipro|webhook|manual
  event_type   text,                                              -- motion|tamper|input|...
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  snapshot_url text,                                              -- 認証プロキシ or 署名対象パス
  clip_url     text,
  status       text        NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new','ack','closed')),
  dedup_key    text,                                              -- 同一発報の重複判定キー
  notified_at  timestamptz,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alarm_events_store    ON alarm_events(store_id);
CREATE INDEX IF NOT EXISTS idx_alarm_events_status   ON alarm_events(status);
CREATE INDEX IF NOT EXISTS idx_alarm_events_occurred ON alarm_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_alarm_events_dedup    ON alarm_events(store_id, dedup_key, occurred_at);

-- ---------------------------------------------------------------------------
-- 3. RLS（security 系と同パターン）
-- ---------------------------------------------------------------------------
ALTER TABLE alarm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE alarm_events   ENABLE ROW LEVEL SECURITY;

-- alarm_settings（store-scoped SELECT / admin modify）
DROP POLICY IF EXISTS "alarm_settings_select" ON alarm_settings;
CREATE POLICY "alarm_settings_select" ON alarm_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = alarm_settings.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()
                ))
                OR alarm_settings.store_id = ANY(u.store_ids)
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS "alarm_settings_modify" ON alarm_settings;
CREATE POLICY "alarm_settings_modify" ON alarm_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- alarm_events（store-scoped SELECT / admin modify）
DROP POLICY IF EXISTS "alarm_events_select" ON alarm_events;
CREATE POLICY "alarm_events_select" ON alarm_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = alarm_events.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()
                ))
                OR alarm_events.store_id = ANY(u.store_ids)
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS "alarm_events_modify" ON alarm_events;
CREATE POLICY "alarm_events_modify" ON alarm_events
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );
