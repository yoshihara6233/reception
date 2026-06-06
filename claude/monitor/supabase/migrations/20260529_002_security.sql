-- 警備 (Security Guard) Feature — Phase 1
-- 警備会社が警備先の既設カメラを巡回・分析・報告するためのテーブル群。
-- BCP (20260528_001_bcp.sql) と同形のパターンを複製（PoC後に共通エンジン化＝Approach B）。
--
-- RLS は 20260520_002_fix_rls_auth_user_id.sql 以降の正しいパターン
--   admin_users.auth_user_id = auth.uid()  を最初から使用（BCP の u.id 誤用を回避）。
--
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS throughout.

-- ---------------------------------------------------------------------------
-- 1. edge_devices.status CHECK に 'security' を追加（巡回キャプチャ中の状態）
--    既存の値リスト（20260528_001_bcp.sql で 'bcp' まで追加済み）を拡張。
-- ---------------------------------------------------------------------------
ALTER TABLE edge_devices
  DROP CONSTRAINT IF EXISTS edge_devices_status_check;

ALTER TABLE edge_devices
  ADD CONSTRAINT edge_devices_status_check
    CHECK (status IN ('offline','idle','grid','live','vod','error','bcp','security'));

-- ---------------------------------------------------------------------------
-- 2. security_settings : 店舗別 警備設定
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_settings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid        UNIQUE REFERENCES stores(id),
  patrol_interval_min int       NOT NULL DEFAULT 30 CHECK (patrol_interval_min BETWEEN 1 AND 1440),
  business_hours    jsonb,                                  -- {start:"00:00", end:"24:00", days:[0..6]} 省略時=常時
  ai_enabled        boolean     NOT NULL DEFAULT false,
  ai_daily_cap      int         NOT NULL DEFAULT 200 CHECK (ai_daily_cap >= 0),  -- 店舗毎日次AI呼出上限
  notify_emails     text[],
  report_show_verification boolean NOT NULL DEFAULT true,   -- 報告書に検証方法/カバレッジを明示
  enabled           boolean     NOT NULL DEFAULT true,
  last_run_at       timestamptz,                            -- pg_cron が「期限」判定に使用
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_settings_store ON security_settings(store_id);

DROP TRIGGER IF EXISTS trg_security_settings_updated_at ON security_settings;
CREATE TRIGGER trg_security_settings_updated_at
  BEFORE UPDATE ON security_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. security_camera_config : カメラ別 巡回設定（ベースライン・プロンプト）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_camera_config (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id          uuid        UNIQUE REFERENCES recorder_cameras(id),
  baseline_day_url   text,                                  -- 正常時 基準画像（昼）
  baseline_night_url text,                                  -- 正常時 基準画像（夜）
  ai_prompt          text,                                  -- カメラ毎の比較プロンプト（状態検出のみ・顔識別禁止）
  sensitivity        numeric     NOT NULL DEFAULT 0.30 CHECK (sensitivity BETWEEN 0 AND 1),  -- 差分閾値
  patrol_enabled     boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_camera_config_camera ON security_camera_config(camera_id);

DROP TRIGGER IF EXISTS trg_security_camera_config_updated_at ON security_camera_config;
CREATE TRIGGER trg_security_camera_config_updated_at
  BEFORE UPDATE ON security_camera_config
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. patrol_runs : 巡回1回ごとの実行レコード
--    冪等制約: scheduled 巡回は (store_id, scheduled_for) で一意。
--    pg_cron 再起動時の二重発火を防ぐ（manual/emergency は scheduled_for=NULL で対象外）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patrol_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        REFERENCES stores(id),
  trigger       text        NOT NULL DEFAULT 'scheduled'
                            CHECK (trigger IN ('scheduled','manual','emergency')),
  scheduled_for timestamptz,                                -- scheduled のみ。冪等キー
  started_at    timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','capturing','analyzing','done','failed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patrol_runs_store  ON patrol_runs(store_id);
CREATE INDEX IF NOT EXISTS idx_patrol_runs_status ON patrol_runs(status);

-- 冪等: 同一店舗・同一予定時刻の scheduled 巡回は1件のみ
CREATE UNIQUE INDEX IF NOT EXISTS uq_patrol_runs_scheduled
  ON patrol_runs(store_id, scheduled_for)
  WHERE trigger = 'scheduled' AND scheduled_for IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. patrol_findings : 巡回内のカメラ毎の所見
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patrol_findings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid        REFERENCES patrol_runs(id),
  camera_id     uuid        REFERENCES recorder_cameras(id),
  snapshot_url  text,
  diff_score    numeric,                                    -- 0..1 ベースライン差分
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','normal','anomaly','review','confirmed','false_positive')),
  ai_status     text        NOT NULL DEFAULT 'none'
                            CHECK (ai_status IN ('none','pending','done','error','skipped')),
  ai_verdict    text,                                       -- 'normal' | 'anomaly'
  ai_reason     text,
  ai_confidence numeric,                                    -- 0..1
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patrol_findings_run    ON patrol_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_patrol_findings_status ON patrol_findings(status);
CREATE INDEX IF NOT EXISTS idx_patrol_findings_ai     ON patrol_findings(ai_status);

-- ---------------------------------------------------------------------------
-- 6. security_reports : 生成された警備報告書
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid        REFERENCES stores(id),
  period_from    timestamptz NOT NULL,
  period_to      timestamptz NOT NULL,
  pdf_url        text,
  generated_at   timestamptz,
  sent_to_emails text[],
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_reports_store ON security_reports(store_id);

-- ---------------------------------------------------------------------------
-- 7. RLS — 4つ（settings/config/runs/findings/reports）に有効化
-- ---------------------------------------------------------------------------
ALTER TABLE security_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_camera_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_findings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_reports       ENABLE ROW LEVEL SECURITY;

-- security_settings (store-scoped)
DROP POLICY IF EXISTS "security_settings_select" ON security_settings;
CREATE POLICY "security_settings_select" ON security_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = security_settings.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()
                ))
                OR security_settings.store_id = ANY(u.store_ids)
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS "security_settings_modify" ON security_settings;
CREATE POLICY "security_settings_modify" ON security_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- security_camera_config
DROP POLICY IF EXISTS "security_camera_config_select" ON security_camera_config;
CREATE POLICY "security_camera_config_select" ON security_camera_config
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "security_camera_config_modify" ON security_camera_config;
CREATE POLICY "security_camera_config_modify" ON security_camera_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- patrol_runs
DROP POLICY IF EXISTS "patrol_runs_select" ON patrol_runs;
CREATE POLICY "patrol_runs_select" ON patrol_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = patrol_runs.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()
                ))
                OR patrol_runs.store_id = ANY(u.store_ids)
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS "patrol_runs_modify" ON patrol_runs;
CREATE POLICY "patrol_runs_modify" ON patrol_runs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- patrol_findings (piggy-back on patrol_runs)
DROP POLICY IF EXISTS "patrol_findings_select" ON patrol_findings;
CREATE POLICY "patrol_findings_select" ON patrol_findings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM patrol_runs r WHERE r.id = patrol_findings.run_id)
  );

DROP POLICY IF EXISTS "patrol_findings_modify" ON patrol_findings;
CREATE POLICY "patrol_findings_modify" ON patrol_findings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- security_reports
DROP POLICY IF EXISTS "security_reports_select" ON security_reports;
CREATE POLICY "security_reports_select" ON security_reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = security_reports.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()
                ))
                OR security_reports.store_id = ANY(u.store_ids)
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS "security_reports_modify" ON security_reports;
CREATE POLICY "security_reports_modify" ON security_reports
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Storage bucket : 巡回スナップショット（private）
--    ingest API は service-role で書込み・署名URLで読取り。
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('security-snapshots', 'security-snapshots', false)
ON CONFLICT (id) DO NOTHING;
