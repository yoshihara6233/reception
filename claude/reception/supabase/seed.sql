-- Seed data for development
-- Creates 1 tenant, 1 store, 1 area, 1 admin user

INSERT INTO tenants (id, name, slug) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Demo Retail Corp', 'demo-retail');

INSERT INTO stores (id, tenant_id, name, address) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '渋谷店', '東京都渋谷区神南1-1-1');

INSERT INTO areas (id, store_id, tenant_id, name, qr_token) VALUES
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'バックヤード入口', 'demo-qr-token-abc123');

-- Admin user will be created after Supabase Auth signup
-- INSERT INTO admin_users (tenant_id, email, name, role, auth_user_id) VALUES (...)
