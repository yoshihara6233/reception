-- セキュリティ修正: FOR ALL の *_modify ポリシーによるクロステナント読取り漏れを塞ぐ。
-- 2026-06-21: authz契約テスト(Phase A/G1)が検出。
--   `edges_modify` 等は `FOR ALL`(=SELECTも含む) かつ USING が「admin系ロールなら誰でも」
--   だったため、テナント限定の `*_select` と OR 合成され、tenant_admin/store_manager が
--   他テナントの edge/recorder/camera/session_limit を **SELECT できてしまっていた**。
--   → modify の USING/WITH CHECK を「閲覧可能な行(select相当・テナント限定)」にスコープし、
--     SELECT 漏れと cross-tenant 書込みの両方を塞ぐ。

-- ── edge_devices: modify を select と同じ可視範囲にスコープ ──
DROP POLICY IF EXISTS "edges_modify" ON edge_devices;
CREATE POLICY "edges_modify" ON edge_devices
  FOR ALL
  USING (
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
  )
  WITH CHECK (
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

-- ── recorders: edge の可視性に連鎖(select と同じ) ──
DROP POLICY IF EXISTS "recorders_modify" ON recorders;
CREATE POLICY "recorders_modify" ON recorders
  FOR ALL
  USING (EXISTS (SELECT 1 FROM edge_devices e WHERE e.id = recorders.edge_id))
  WITH CHECK (EXISTS (SELECT 1 FROM edge_devices e WHERE e.id = recorders.edge_id));

-- ── recorder_cameras: recorder の可視性に連鎖(select と同じ) ──
DROP POLICY IF EXISTS "cameras_modify" ON recorder_cameras;
CREATE POLICY "cameras_modify" ON recorder_cameras
  FOR ALL
  USING (EXISTS (SELECT 1 FROM recorders r WHERE r.id = recorder_cameras.recorder_id))
  WITH CHECK (EXISTS (SELECT 1 FROM recorders r WHERE r.id = recorder_cameras.recorder_id));

-- ── session_limits: modify を super_admin or 自テナント tenant_admin にスコープ ──
DROP POLICY IF EXISTS "limits_modify" ON session_limits;
CREATE POLICY "limits_modify" ON session_limits
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid()
      AND (u.role = 'super_admin' OR (u.role = 'tenant_admin' AND u.tenant_id = session_limits.tenant_id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid()
      AND (u.role = 'super_admin' OR (u.role = 'tenant_admin' AND u.tenant_id = session_limits.tenant_id)))
  );

-- ── live_sessions: select をテナント/店舗にスコープ(従来は tenant_admin/super が全件) ──
DROP POLICY IF EXISTS "sessions_select" ON live_sessions;
CREATE POLICY "sessions_select" ON live_sessions
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid() AND u.role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM admin_users u
      JOIN stores s ON s.id = live_sessions.store_id
      WHERE u.auth_user_id = auth.uid()
        AND (
          (u.role = 'tenant_admin' AND s.tenant_id = u.tenant_id)
          OR (u.role = 'store_manager' AND s.id = ANY(u.store_ids))
        )
    )
  );
