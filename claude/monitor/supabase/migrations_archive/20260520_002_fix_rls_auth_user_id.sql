-- Fix RLS policies: reception's admin_users links to auth.users via auth_user_id,
-- not id. Replace u.id = auth.uid() with u.auth_user_id = auth.uid() everywhere.

-- ---------------------------------------------------------------------------
-- edge_devices
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "edges_select" ON edge_devices;
CREATE POLICY "edges_select" ON edge_devices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (
          u.role = 'super_admin'
          OR EXISTS (SELECT 1 FROM stores s
                     WHERE s.id = edge_devices.store_id
                       AND (u.role = 'tenant_admin' AND s.tenant_id IN (
                              SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()
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
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- recorders
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "recorders_modify" ON recorders;
CREATE POLICY "recorders_modify" ON recorders
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- recorder_cameras
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cameras_modify" ON recorder_cameras;
CREATE POLICY "cameras_modify" ON recorder_cameras
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin','store_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- session_limits
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "limits_select" ON session_limits;
CREATE POLICY "limits_select" ON session_limits
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (u.role = 'super_admin' OR u.tenant_id = session_limits.tenant_id)
    )
  );

DROP POLICY IF EXISTS "limits_modify" ON session_limits;
CREATE POLICY "limits_modify" ON session_limits
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('super_admin','tenant_admin')
    )
  );
