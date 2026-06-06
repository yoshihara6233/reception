-- ===========================================================================
-- F57: Supabase Advisor "View is defined with SECURITY DEFINER property" 修正
--
-- 使い方:
--   1. Supabase Dashboard → SQL Editor
--   2. このファイルの中身を全部コピペ → Run
--   3. 末尾の SELECT 結果で全 VIEW が security_invoker = 'true' なら完了
--
-- ALTER VIEW … SET (security_invoker = true) は CREATE OR REPLACE より軽く、
-- ビュー定義の再記述が不要なので、ここではこちらを採用 (PG 15+ 専用構文)。
-- ===========================================================================

-- ─── すべての public.* な VIEW に security_invoker を ON ────────────────
ALTER VIEW public.v_store_nvr_lifecycle      SET (security_invoker = true);
ALTER VIEW public.v_nvr_lifecycle_summary    SET (security_invoker = true);
ALTER VIEW public.v_nvr_lifecycle_by_model   SET (security_invoker = true);
ALTER VIEW public.v_heartbeat_rollout_status SET (security_invoker = true);

-- F56 で作った VIEW も同様に (存在すれば)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'v_partition_rls_status' AND c.relkind = 'v'
  ) THEN
    EXECUTE 'ALTER VIEW public.v_partition_rls_status SET (security_invoker = true)';
  END IF;
END $$;

-- ─── 結果確認: 全 public.v_* VIEW の security_invoker 状態 ──────────────
SELECT
  c.relname                          AS view_name,
  COALESCE(
    (SELECT split_part(opt, '=', 2)
       FROM unnest(c.reloptions) AS opt
      WHERE opt LIKE 'security_invoker=%'),
    'false (DEFAULT)'
  )                                  AS security_invoker
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v'
  AND n.nspname = 'public'
  AND c.relname LIKE 'v_%'
ORDER BY view_name;
-- → 全 VIEW で security_invoker = 'true' なら OK
