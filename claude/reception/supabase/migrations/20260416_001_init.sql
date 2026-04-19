-- Reception Kiosk SaaS — Initial Schema
-- All tables use UUID primary keys and tenant_id for RLS

-- 1. Tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  settings JSONB DEFAULT '{
    "require_business_card": "optional",
    "require_face_photo": "optional",
    "visit_purposes": ["配送", "メンテナンス", "商談", "監査", "その他"],
    "photo_retention_days": 90,
    "visit_retention_days": 365,
    "long_stay_alert_minutes": null,
    "notification_channels": []
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Stores
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT DEFAULT 'Asia/Tokyo',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_stores_tenant ON stores(tenant_id);

-- 3. Areas (each area has a unique QR token)
CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  qr_token TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_areas_store ON areas(store_id);
CREATE INDEX idx_areas_qr_token ON areas(qr_token);

-- 4. Visitors
CREATE TABLE visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  company TEXT NOT NULL,
  department TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  device_token TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_visitors_tenant ON visitors(tenant_id);
CREATE INDEX idx_visitors_company ON visitors(tenant_id, company);
CREATE INDEX idx_visitors_device ON visitors(device_token) WHERE device_token IS NOT NULL;

-- 5. Visits
CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  visitor_id UUID REFERENCES visitors(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'checked_in'
    CHECK (status IN ('checked_in', 'checked_out', 'auto_closed')),
  check_in_at TIMESTAMPTZ DEFAULT now(),
  check_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_visits_tenant ON visits(tenant_id);
CREATE INDEX idx_visits_store ON visits(store_id);
CREATE INDEX idx_visits_status ON visits(tenant_id, status);
CREATE INDEX idx_visits_checkin ON visits(tenant_id, check_in_at DESC);

-- 6. Visit Photos
CREATE TABLE visit_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visits(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('face', 'card')),
  storage_path TEXT NOT NULL,
  ocr_result JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_visit_photos_visit ON visit_photos(visit_id);

-- 7. Admin Users
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('super_admin', 'tenant_admin', 'store_manager', 'viewer')),
  store_ids UUID[] DEFAULT '{}',
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_admin_users_email_tenant ON admin_users(tenant_id, email);
CREATE INDEX idx_admin_users_auth ON admin_users(auth_user_id);

-- 8. Audit Logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  admin_user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  details JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id, created_at DESC);

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Helper: get current admin user's tenant_id from JWT
CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS UUID AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: get current admin user's role
CREATE OR REPLACE FUNCTION get_admin_role()
RETURNS TEXT AS $$
  SELECT role FROM admin_users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: get current admin user's store_ids
CREATE OR REPLACE FUNCTION get_admin_store_ids()
RETURNS UUID[] AS $$
  SELECT store_ids FROM admin_users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: validate QR token and return area info
CREATE OR REPLACE FUNCTION validate_qr_token(token TEXT)
RETURNS TABLE(area_id UUID, store_id UUID, tenant_id UUID) AS $$
  SELECT a.id, a.store_id, a.tenant_id
  FROM areas a
  JOIN stores s ON a.store_id = s.id
  WHERE a.qr_token = token
    AND a.is_active = true
    AND s.is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Tenants: admin can see own tenant
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_own_tenant" ON tenants
  FOR SELECT USING (id = get_tenant_id());

-- Stores: admin can manage own tenant's stores
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_manage_stores" ON stores
  FOR ALL USING (tenant_id = get_tenant_id());

-- Areas: admin can manage own tenant's areas
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_manage_areas" ON areas
  FOR ALL USING (tenant_id = get_tenant_id());
-- Anon can read areas by qr_token (for visitor flow validation)
CREATE POLICY "anon_read_area_by_token" ON areas
  FOR SELECT USING (true);

-- Visitors: admin can read own tenant's visitors
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_visitors" ON visitors
  FOR SELECT USING (tenant_id = get_tenant_id());
-- Service role inserts visitors (via API route after QR validation)
CREATE POLICY "service_insert_visitors" ON visitors
  FOR INSERT WITH CHECK (true);

-- Visits: admin can read own tenant's visits
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_visits" ON visits
  FOR ALL USING (tenant_id = get_tenant_id());
-- Service role inserts/updates visits
CREATE POLICY "service_manage_visits" ON visits
  FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update_visits" ON visits
  FOR UPDATE USING (true);

-- Visit Photos: admin can read own tenant's photos
ALTER TABLE visit_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_photos" ON visit_photos
  FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "service_insert_photos" ON visit_photos
  FOR INSERT WITH CHECK (true);

-- Admin Users: admin can manage own tenant's admin users
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_manage_users" ON admin_users
  FOR ALL USING (tenant_id = get_tenant_id());

-- Audit Logs: admin can read own tenant's logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_audit" ON audit_logs
  FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "service_insert_audit" ON audit_logs
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- Auto-checkout function (called by pg_cron or Edge Function)
-- ============================================================
CREATE OR REPLACE FUNCTION auto_checkout_stale_visits()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE visits
  SET status = 'auto_closed',
      check_out_at = now()
  WHERE status = 'checked_in'
    AND check_in_at < now() - interval '24 hours';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
