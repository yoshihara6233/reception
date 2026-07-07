-- ---------------------------------------------------------------------------
-- F56: Partition RLS Fix
--
-- Problem:
--   Supabase Security Advisor flags `live_sessions_YYYYMM` (子パーティション) as
--   "Table publicly accessible — RLS not enabled".
--
-- Root cause:
--   PostgreSQL の RLS は以下の特性を持つ:
--   - POLICY は親テーブルに作れば子パーティションに継承される ✅
--   - ENABLE ROW LEVEL SECURITY フラグは 各パーティションごとに個別に必要 ❌
--   Supabase の PostgREST は子テーブルも個別の API endpoint として公開するため、
--   子テーブルの RLS フラグが OFF だと anon key で直接アクセスされ得る。
--
-- Fix:
--   1. 既存の全 live_sessions パーティションを ENABLE ROW LEVEL SECURITY
--   2. パーティション作成ヘルパー関数 create_live_sessions_partition() を導入し、
--      新規月次パーティションでも自動で RLS が ON になるようにする
--   3. 既存ブートストラップロジックを置き換え
-- ---------------------------------------------------------------------------

-- 1. 既存の全パーティションに RLS を遡及適用
--    対象: live_sessions_YYYYMM, monitor_results_YYYYMM
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
    RAISE NOTICE '[F56] Enabled RLS on partition % (parent=%)', part.name, part.parent;
  END LOOP;
END $$;

-- 2. 新規パーティション作成用ヘルパー関数
--    呼び出し例: SELECT create_live_sessions_partition(date '2026-07-01');
CREATE OR REPLACE FUNCTION create_live_sessions_partition(p_start date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  p_end     date := (p_start + interval '1 month')::date;
  part_name text := 'live_sessions_' || to_char(p_start, 'YYYYMM');
BEGIN
  -- (a) パーティション作成 (既存ならスキップ)
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.live_sessions ' ||
    'FOR VALUES FROM (%L) TO (%L)',
    part_name, p_start, p_end
  );

  -- (b) RLS を ON (Supabase advisor 対策)
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part_name);

  RAISE NOTICE '[F56] Created partition % with RLS enabled', part_name;
  RETURN part_name;
END;
$$;

COMMENT ON FUNCTION create_live_sessions_partition(date) IS
  'F56: live_sessions の月次パーティションを RLS 有効化付きで作成。';

-- 2-B. monitor_results のヘルパー関数を更新 (既存の monitor_results_ensure_partition を上書き)
--      既存 (20260530_001) は RLS ON が抜けていたので、ここで補強。
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
  -- F56: 既存パーティションでも安全に ON にできる (冪等)
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_name);
END $$;

COMMENT ON FUNCTION monitor_results_ensure_partition(date) IS
  'F56: monitor_results の月次パーティションを RLS 有効化付きで作成 (冪等)。';

-- 3. 確認用 VIEW: 全パーティションの RLS 状態を一覧 (live_sessions + monitor_results)
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

COMMENT ON VIEW v_partition_rls_status IS
  'F56: パーティションテーブルの子ごとの RLS 状態を確認するための VIEW';

-- ---------------------------------------------------------------------------
-- Verification (実行後に手動でチェック):
--
--   SELECT * FROM v_partition_rls_status;
--   -- 全行が rls_enabled = true なら OK
--
--   -- 次月分のパーティションを先回りで作る (月初の cron 想定):
--   SELECT create_live_sessions_partition(date_trunc('month', now() + interval '2 month')::date);
--   SELECT monitor_results_ensure_partition((now() + interval '2 month')::date);
-- ---------------------------------------------------------------------------
