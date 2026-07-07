-- Fix BCP RLS policies: replace u.id = auth.uid() with u.auth_user_id = auth.uid()
--
-- 20260528_001_bcp.sql was written before the auth_user_id fix
-- (20260520_002_fix_rls_auth_user_id.sql).  admin_users.id is the table's
-- own UUID primary key; the column that maps to Supabase Auth is
-- admin_users.auth_user_id.  Using id meant all INSERT/SELECT were silently
-- blocked for every authenticated user.

-- ---------------------------------------------------------------------------
-- bcp_events
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bcp_events_select" ON bcp_events;
CREATE POLICY "bcp_events_select" ON bcp_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = bcp_events.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()
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
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- bcp_clips
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
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- bcp_reports
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
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- bcp_settings
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bcp_settings_select" ON bcp_settings;
CREATE POLICY "bcp_settings_select" ON bcp_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = bcp_settings.store_id
              AND (
                (u.role = 'tenant_admin' AND s.tenant_id IN (
                  SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()
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
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );
