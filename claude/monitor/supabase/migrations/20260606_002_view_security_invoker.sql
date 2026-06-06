-- ---------------------------------------------------------------------------
-- F57: View SECURITY DEFINER → SECURITY INVOKER 修正
--
-- Problem:
--   Supabase Security Advisor が以下を Warning として検知:
--     "View public.v_nvr_lifecycle_by_model is defined with the SECURITY DEFINER property"
--
-- Root cause:
--   PostgreSQL の VIEW は デフォルトで "SECURITY DEFINER 相当" の挙動になる。
--   つまり VIEW 作成者 (Supabase では postgres superuser) の権限で内部 SELECT
--   が実行されるため、underlying table の RLS が **作成者の権限で評価される**。
--   結果として anon キーで /rest/v1/<view> にアクセスされた際、underlying
--   table の RLS をバイパスして全件読める可能性がある。
--
-- Fix:
--   PostgreSQL 15+ で導入された WITH (security_invoker = true) を全 VIEW に付与。
--   これにより VIEW を SELECT したユーザの権限・RLS が underlying table に
--   適用される。
--
-- Affected views (依存チェーン):
--   v_nvr_lifecycle_by_model     ← Advisor 警告対象
--          ↓
--   v_nvr_lifecycle_summary
--          ↓
--   v_store_nvr_lifecycle        ← stores テーブルを参照
--
--   v_heartbeat_rollout_status   ← stores / heartbeat_override 参照
--   v_partition_rls_status       ← pg_class 参照 (システム catalog のみ)
-- ---------------------------------------------------------------------------

-- ─── 1. v_store_nvr_lifecycle (元: F46.8) ─────────────────────────────────
CREATE OR REPLACE VIEW v_store_nvr_lifecycle
WITH (security_invoker = true) AS
SELECT
  s.id                                                    AS store_id,
  s.name                                                  AS store_name,
  s.deployment_mode,
  s.nvr_vendor,
  s.nvr_model,
  s.nvr_fw_version,
  s.nvr_fw_detected_at,
  s.nvr_installed_at,
  s.nvr_eol_date,
  s.nvr_eos_date,
  s.nvr_replace_by,

  -- 残月数 (EOS まで; 経過時は負)
  CASE
    WHEN s.nvr_eos_date IS NOT NULL THEN
      (EXTRACT(YEAR  FROM age(s.nvr_eos_date, CURRENT_DATE)) * 12
     + EXTRACT(MONTH FROM age(s.nvr_eos_date, CURRENT_DATE)))::int
    ELSE NULL
  END                                                     AS months_until_eos,

  -- 運用年数
  CASE
    WHEN s.nvr_installed_at IS NOT NULL THEN
      EXTRACT(YEAR FROM age(CURRENT_DATE, s.nvr_installed_at))::int
    ELSE NULL
  END                                                     AS years_in_service,

  -- 残月数 (置換期限 = nvr_replace_by まで)
  CASE
    WHEN s.nvr_replace_by IS NOT NULL THEN
      (EXTRACT(YEAR  FROM age(s.nvr_replace_by, CURRENT_DATE)) * 12
     + EXTRACT(MONTH FROM age(s.nvr_replace_by, CURRENT_DATE)))::int
    ELSE NULL
  END                                                     AS months_until_replace_by,

  -- ステータス分類
  CASE
    WHEN s.nvr_installed_at IS NULL OR s.nvr_eos_date IS NULL THEN
      'nvr_lifecycle_unknown'
    WHEN CURRENT_DATE > s.nvr_eos_date THEN
      'nvr_lifecycle_eos'
    WHEN s.nvr_installed_at + INTERVAL '7 years' < CURRENT_DATE THEN
      'nvr_lifecycle_overage'
    WHEN s.nvr_eos_date <= CURRENT_DATE + INTERVAL '6 months' THEN
      'nvr_lifecycle_urgent'
    WHEN s.nvr_eos_date <= CURRENT_DATE + INTERVAL '12 months' THEN
      'nvr_lifecycle_replace_planned'
    WHEN s.nvr_eos_date <= CURRENT_DATE + INTERVAL '24 months' THEN
      'nvr_lifecycle_warning'
    ELSE
      'nvr_lifecycle_ok'
  END                                                     AS lifecycle_status

FROM stores s;

COMMENT ON VIEW v_store_nvr_lifecycle IS
  '全店舗の NVR ライフサイクル状態。/infra ダッシュボードのアラートサマリで使用 (F57: security_invoker = true)';

-- ─── 2. v_nvr_lifecycle_summary (元: F46.8) ──────────────────────────────
CREATE OR REPLACE VIEW v_nvr_lifecycle_summary
WITH (security_invoker = true) AS
SELECT
  lifecycle_status,
  COUNT(*) AS store_count,
  CASE lifecycle_status
    WHEN 'nvr_lifecycle_eos'              THEN 1
    WHEN 'nvr_lifecycle_overage'          THEN 2
    WHEN 'nvr_lifecycle_urgent'           THEN 3
    WHEN 'nvr_lifecycle_replace_planned'  THEN 4
    WHEN 'nvr_lifecycle_warning'          THEN 5
    WHEN 'nvr_lifecycle_ok'               THEN 6
    ELSE 7
  END AS sort_order
FROM v_store_nvr_lifecycle
GROUP BY lifecycle_status
ORDER BY sort_order;

COMMENT ON VIEW v_nvr_lifecycle_summary IS
  '/infra ダッシュボードのライフサイクルサマリカード用 (F57: security_invoker = true)';

-- ─── 3. v_nvr_lifecycle_by_model (元: F46.8) ─── ★ Advisor 警告対象 ──────
CREATE OR REPLACE VIEW v_nvr_lifecycle_by_model
WITH (security_invoker = true) AS
SELECT
  nvr_vendor,
  nvr_model,
  lifecycle_status,
  COUNT(*) AS store_count
FROM v_store_nvr_lifecycle
WHERE nvr_model IS NOT NULL
GROUP BY nvr_vendor, nvr_model, lifecycle_status
ORDER BY nvr_vendor, nvr_model, lifecycle_status;

COMMENT ON VIEW v_nvr_lifecycle_by_model IS
  '機種別 × ライフサイクル状態の集計。/infra/lifecycle 画面で使用 (F57: security_invoker = true)';

-- ─── 4. v_heartbeat_rollout_status (元: F51.B) ──────────────────────────
-- 元ファイル: 20260605_004_heartbeat_override.sql
CREATE OR REPLACE VIEW v_heartbeat_rollout_status
WITH (security_invoker = true) AS
SELECT
  s.deployment_mode,
  CASE
    WHEN s.heartbeat_override_sec IS NOT NULL THEN s.heartbeat_override_sec
    WHEN s.deployment_mode = 'central_aggregator'  THEN 21600   -- 6h
    WHEN s.deployment_mode = 'per_store_minipc'    THEN 60      -- 60s
    ELSE 60
  END                                                AS effective_interval_sec,
  s.heartbeat_override_sec IS NOT NULL              AS has_override,
  COUNT(*)                                           AS store_count
FROM stores s
GROUP BY s.deployment_mode, effective_interval_sec, has_override
ORDER BY s.deployment_mode, effective_interval_sec;

COMMENT ON VIEW v_heartbeat_rollout_status IS
  'F51.B: ハートビート間隔の分布状況。/infra/slo や rollout CLI から参照 (F57: security_invoker = true)';

-- ─── 5. v_partition_rls_status (元: F56) ─────────────────────────────────
CREATE OR REPLACE VIEW v_partition_rls_status
WITH (security_invoker = true) AS
SELECT
  p.relname                          AS parent_table,
  c.relname                          AS partition_name,
  c.relrowsecurity                   AS rls_enabled,
  c.relforcerowsecurity              AS rls_forced,
  pg_get_expr(c.relpartbound, c.oid) AS partition_bound
FROM pg_class c
JOIN pg_inherits i ON i.inhrelid = c.oid
JOIN pg_class p   ON p.oid = i.inhparent
WHERE p.relname IN ('live_sessions', 'monitor_results')
ORDER BY p.relname, c.relname;

COMMENT ON VIEW v_partition_rls_status IS
  'F56: パーティションテーブルの子ごとの RLS 状態 (F57: security_invoker = true)';

-- ---------------------------------------------------------------------------
-- Verification:
--
--   -- security_invoker が true になっているか確認
--   SELECT n.nspname || '.' || c.relname AS view_name,
--          (SELECT option_value
--             FROM pg_options_to_table(c.reloptions)
--            WHERE option_name = 'security_invoker') AS security_invoker
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE c.relkind = 'v'
--     AND n.nspname = 'public'
--     AND c.relname LIKE 'v_%'
--   ORDER BY view_name;
--   -- → 全 VIEW で security_invoker = 'true' なら OK
-- ---------------------------------------------------------------------------
