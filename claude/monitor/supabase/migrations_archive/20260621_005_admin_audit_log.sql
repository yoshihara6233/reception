-- 管理操作の監査ログ（Phase B: レコーダ管理UI の受入「監査ログ」）。
-- 2026-06-21: admin UI からの設定変更（recorder / camera / edge のライブ/VOD/go2rtc 系）を
--   「誰が・いつ・何を」記録する。値は changes(jsonb) に保持（秘密はアプリ側でマスク）。
--   セッション視聴履歴は live_sessions、汎用テレメトリは metric_events と役割分離。

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts            timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,                                   -- auth.users.id（操作者）
  action        text NOT NULL,                          -- 例 'recorder.update' / 'recorder.cameras' / 'edge.update'
  target_type   text NOT NULL,                          -- 'recorder' / 'recorder_cameras' / 'edge'
  target_id     uuid,
  store_id      uuid REFERENCES stores(id) ON DELETE SET NULL,   -- RLS スコープ用
  changes       jsonb                                   -- 変更内容（秘密はアプリ側でマスク）
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_ts       ON admin_audit_log (ts);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_store_ts ON admin_audit_log (store_id, ts);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor    ON admin_audit_log (actor_user_id, ts);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- 読取り: super_admin=全件 / tenant_admin・store_manager=自分の店舗スコープ
-- （metric_events_select と同じ方針。store_id NULL は super_admin のみ閲覧可）。
DROP POLICY IF EXISTS admin_audit_log_select ON admin_audit_log;
CREATE POLICY admin_audit_log_select ON admin_audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid() AND u.role = 'super_admin')
    OR (store_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM admin_users u JOIN stores s ON s.id = admin_audit_log.store_id
      WHERE u.auth_user_id = auth.uid()
        AND ((u.role = 'tenant_admin' AND s.tenant_id = u.tenant_id)
          OR (u.role = 'store_manager' AND s.id = ANY(u.store_ids)))
    ))
  );

-- 挿入: ログイン中の管理者が、自分を actor として記録する場合のみ。
DROP POLICY IF EXISTS admin_audit_log_insert ON admin_audit_log;
CREATE POLICY admin_audit_log_insert ON admin_audit_log
  FOR INSERT WITH CHECK (
    actor_user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid())
  );

COMMENT ON TABLE admin_audit_log IS
  '管理操作の監査ログ(recorder/camera/edge 設定変更)。視聴=live_sessions / 計測=metric_events と分離。';
