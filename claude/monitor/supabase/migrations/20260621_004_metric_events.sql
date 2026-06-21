-- C3 計測イベントスキーマ（Phase A・day1 から実測を貯める）。
-- 2026-06-21: 視聴/同時は live_sessions で取得済み。本表は遅延(latency)・稼働(uptime)
--   などの汎用テレメトリを1か所に貯める。保持期限は cron で 90日プルーン。
--   kind 例: 'edge_uptime'(value 1=up/0=down), 'ttff_ms'(初フレーム表示まで),
--           'latency_ms', 'vod_ready_ms' など。

CREATE TABLE IF NOT EXISTS metric_events (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  kind      text NOT NULL,
  store_id  uuid REFERENCES stores(id)           ON DELETE SET NULL,
  edge_id   uuid REFERENCES edge_devices(id)     ON DELETE SET NULL,
  camera_id uuid REFERENCES recorder_cameras(id) ON DELETE SET NULL,
  user_id   uuid,
  value     double precision,
  meta      jsonb
);

CREATE INDEX IF NOT EXISTS idx_metric_events_ts        ON metric_events (ts);
CREATE INDEX IF NOT EXISTS idx_metric_events_kind_ts   ON metric_events (kind, ts);
CREATE INDEX IF NOT EXISTS idx_metric_events_store_ts  ON metric_events (store_id, ts);

ALTER TABLE metric_events ENABLE ROW LEVEL SECURITY;

-- 読取り: super_admin=全件 / tenant_admin・store_manager=自分の店舗スコープ
DROP POLICY IF EXISTS metric_events_select ON metric_events;
CREATE POLICY metric_events_select ON metric_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid() AND u.role = 'super_admin')
    OR (store_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM admin_users u JOIN stores s ON s.id = metric_events.store_id
      WHERE u.auth_user_id = auth.uid()
        AND ((u.role = 'tenant_admin' AND s.tenant_id = u.tenant_id)
          OR (u.role = 'store_manager' AND s.id = ANY(u.store_ids)))
    ))
  );

-- 挿入: ログイン済みなら可（書込みは主に service client = cron / API）
DROP POLICY IF EXISTS metric_events_insert ON metric_events;
CREATE POLICY metric_events_insert ON metric_events
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid())
  );

COMMENT ON TABLE metric_events IS
  'C3 汎用計測テレメトリ(遅延/稼働 等)。視聴/同時は live_sessions。保持90日(cronプルーン)。';
