-- Fix: enable RLS on store_cameras (was missing from initial table creation)
-- This table was created in 20260420_006_store_cameras.sql without RLS,
-- causing a Supabase security alert (rls_disabled_in_public).

ALTER TABLE store_cameras ENABLE ROW LEVEL SECURITY;

-- Admin can manage cameras within their own tenant only
CREATE POLICY "admin_manage_store_cameras" ON store_cameras
  FOR ALL USING (tenant_id = get_tenant_id());
