-- ===========================================================================
-- F56: Supabase Advisor "Table publicly accessible — RLS not enabled" 即時修正
--
-- 使い方:
--   1. Supabase Dashboard → SQL Editor を開く
--   2. このファイルの中身を全部コピー&ペースト
--   3. Run ボタン
--   4. 末尾の SELECT 結果で全行が rls_enabled = true になっていれば完了
-- ===========================================================================

-- ─── Step 1: 既存パーティションに RLS を一括適用 ──────────────────────────
DO $$
DECLARE
  part record;
BEGIN
  FOR part IN
    SELECT c.relname AS name, p.relname AS parent
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p   ON p.oid = i.inhparent
    WHERE p.relname IN ('live_sessions', 'monitor_results')
      AND c.relrowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', part.name);
    RAISE NOTICE 'Enabled RLS on partition % (parent=%)', part.name, part.parent;
  END LOOP;
END $$;

-- ─── Step 2: 新規パーティション作成ヘルパー (RLS 自動 ON) ─────────────────
CREATE OR REPLACE FUNCTION create_live_sessions_partition(p_start date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  p_end     date := (p_start + interval '1 month')::date;
  part_name text := 'live_sessions_' || to_char(p_start, 'YYYYMM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.live_sessions ' ||
    'FOR VALUES FROM (%L) TO (%L)',
    part_name, p_start, p_end
  );
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part_name);
  RETURN part_name;
END;
$$;

CREATE OR REPLACE FUNCTION monitor_results_ensure_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := 'monitor_results_' || to_char(v_start, 'YYYYMM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.monitor_results FOR VALUES FROM (%L) TO (%L);',
      v_name, v_start, v_end);
  END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_name);
END $$;

-- ─── Step 3: 確認用 VIEW ────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_partition_rls_status AS
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

-- ─── Step 4: 結果確認 (このクエリの結果を Run して全行 true なら OK) ──────
SELECT * FROM v_partition_rls_status;
