-- Core Trio: consent_templates, staff_members, pre_registrations, consent_records
-- Generated 2026-04-19

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. consent_templates
-- ============================================================
CREATE TABLE consent_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version TEXT NOT NULL DEFAULT '1.0',
  body_ja TEXT NOT NULL,
  body_en TEXT,
  body_zh TEXT,
  body_ko TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active template per tenant (enforced at DB level)
CREATE UNIQUE INDEX consent_templates_active_per_tenant
  ON consent_templates(tenant_id) WHERE is_active = true;

CREATE INDEX idx_consent_templates_tenant ON consent_templates(tenant_id);

ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_consent_templates" ON consent_templates
  FOR SELECT USING (tenant_id = get_tenant_id());

CREATE POLICY "admin_write_consent_templates" ON consent_templates
  FOR ALL USING (
    tenant_id = get_tenant_id()
    AND get_admin_role() IN ('tenant_admin', 'store_manager')
  );

-- Visitor anon read (to render consent screen)
CREATE POLICY "anon_read_active_consent_template" ON consent_templates
  FOR SELECT USING (
    is_active = true
    AND tenant_id IN (
      SELECT tenant_id FROM areas
      WHERE qr_token = current_setting('app.qr_token', true)
        AND is_active = true
    )
  );

-- ============================================================
-- 2. staff_members
-- ============================================================
CREATE TABLE staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,  -- null = all stores
  name TEXT NOT NULL,
  name_kana TEXT,
  email TEXT,
  -- slack_member_id: for @mention in Incoming Webhook messages (e.g. U012AB3CD)
  -- No OAuth validation possible; UI must guide user to copy from Slack profile
  slack_member_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_members_tenant ON staff_members(tenant_id) WHERE is_active = true;

ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_staff" ON staff_members
  FOR ALL USING (tenant_id = get_tenant_id());

-- Visitor anon read for contact person suggestions
CREATE POLICY "anon_read_staff" ON staff_members
  FOR SELECT USING (
    is_active = true
    AND tenant_id IN (
      SELECT tenant_id FROM areas
      WHERE qr_token = current_setting('app.qr_token', true)
        AND is_active = true
    )
  );

-- ============================================================
-- 3. pre_registrations
-- ============================================================
CREATE TABLE pre_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id),
  area_id UUID NOT NULL REFERENCES areas(id),
  host_user_id UUID NOT NULL REFERENCES admin_users(id),
  visitor_company TEXT NOT NULL,
  visitor_name TEXT NOT NULL,
  visitor_email TEXT,
  visitor_phone TEXT,
  purpose TEXT NOT NULL,
  contact_person_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '48 hours',
  used_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  visit_id UUID REFERENCES visits(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pre_reg_token ON pre_registrations(token);
CREATE INDEX idx_pre_reg_tenant ON pre_registrations(tenant_id);

ALTER TABLE pre_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_pre_reg" ON pre_registrations
  FOR ALL USING (tenant_id = get_tenant_id());

-- Visitor anon read by pre-registration token
CREATE POLICY "anon_read_pre_reg_by_token" ON pre_registrations
  FOR SELECT USING (
    token = current_setting('app.pre_token', true)
    AND expires_at > now()
    AND used_at IS NULL
    AND cancelled_at IS NULL
  );

-- ============================================================
-- 4. consent_records
-- ============================================================
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
  pre_registration_id UUID REFERENCES pre_registrations(id) ON DELETE SET NULL,
  consent_template_id UUID NOT NULL REFERENCES consent_templates(id),
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET,
  user_agent TEXT
);

-- Prevent double-consent for same visit
CREATE UNIQUE INDEX consent_records_visit_template_unique
  ON consent_records(visit_id, consent_template_id)
  WHERE visit_id IS NOT NULL;

CREATE INDEX idx_consent_records_tenant ON consent_records(tenant_id);
CREATE INDEX idx_consent_records_visit ON consent_records(visit_id);

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_consent_records" ON consent_records
  FOR SELECT USING (tenant_id = get_tenant_id());

-- Visitor anon insert
CREATE POLICY "anon_insert_consent_record" ON consent_records
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM areas
      WHERE qr_token = current_setting('app.qr_token', true)
        AND is_active = true
    )
  );

-- ============================================================
-- Helper DB functions for session variables
-- ============================================================

-- Set QR token for current transaction (used by visitor API routes)
CREATE OR REPLACE FUNCTION set_app_qr_token(token TEXT)
RETURNS VOID AS $$
  SELECT set_config('app.qr_token', token, true);
$$ LANGUAGE sql SECURITY DEFINER;

-- Set pre-registration token for current transaction
CREATE OR REPLACE FUNCTION set_app_pre_token(token TEXT)
RETURNS VOID AS $$
  SELECT set_config('app.pre_token', token, true);
$$ LANGUAGE sql SECURITY DEFINER;

-- Activate a new consent template (atomic swap: deactivate old → insert new)
CREATE OR REPLACE FUNCTION activate_consent_template(
  p_tenant_id UUID,
  p_version TEXT,
  p_body_ja TEXT,
  p_body_en TEXT DEFAULT NULL,
  p_body_zh TEXT DEFAULT NULL,
  p_body_ko TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  new_id UUID;
BEGIN
  -- Deactivate existing active template
  UPDATE consent_templates
  SET is_active = false
  WHERE tenant_id = p_tenant_id AND is_active = true;

  -- Insert new active template
  INSERT INTO consent_templates (tenant_id, version, body_ja, body_en, body_zh, body_ko, is_active)
  VALUES (p_tenant_id, p_version, p_body_ja, p_body_en, p_body_zh, p_body_ko, true)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_app_qr_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_app_pre_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION activate_consent_template(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
