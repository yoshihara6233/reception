-- 月次利用状況レポート R1: 日次ロールアップ表 usage_daily ＋ 集計関数 ＋ tenants.report_day。
-- 設計: docs/monthly-usage-report-design.md（アプローチB）。
--
-- 集計は SECURITY DEFINER の SQL 関数 refresh_usage_daily(from,to) で行い、rollup cron
-- （/api/cron/usage-rollup）が直近数日を毎日 upsert する（遅延到着に備え再計算）。
-- Supabase の行取得上限を避けるため集計は SQL(GROUP BY) 側で行う。

-- ── 1. レポート作成日（テナント毎・毎月XX日）────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS report_day smallint;
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_report_day_range;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_report_day_range CHECK (report_day IS NULL OR (report_day BETWEEN 1 AND 28));
COMMENT ON COLUMN public.tenants.report_day IS '月次レポートの作成日（1〜28・毎月）。NULL=既定(28)。29-31は月により無いため28上限。';

-- ── 2. 日次ロールアップ表 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_daily (
  store_id                uuid  NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  tenant_id               uuid  NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  date                    date  NOT NULL,
  patrol_count            int   NOT NULL DEFAULT 0,   -- patrol_runs
  alarm_count             int   NOT NULL DEFAULT 0,   -- alarm_events
  inspection_count        int   NOT NULL DEFAULT 0,   -- inspection_sessions 全体
  baggage_exit_count      int   NOT NULL DEFAULT 0,   -- 退出検査実施(exit_at not null)=映像確認率の分母
  baggage_confirmed_count int   NOT NULL DEFAULT 0,   -- 店長映像確認(confirmed_at not null)=分子
  face_auth_matched       int   NOT NULL DEFAULT 0,   -- 顔認証一致(status=completed)
  face_auth_unmatched     int   NOT NULL DEFAULT 0,   -- アンマッチ(unmatched_entry/exit)
  face_auth_attempts      int   NOT NULL DEFAULT 0,   -- 試行=一致+アンマッチ
  video_live_count        int   NOT NULL DEFAULT 0,   -- live_sessions(参考・運営除外)
  footage_access_count    int   NOT NULL DEFAULT 0,   -- footage_access_log(参考・運営除外)
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, date)
);
CREATE INDEX IF NOT EXISTS usage_daily_tenant_date ON public.usage_daily (tenant_id, date);

-- ── 3. RLS（既存 auth_user_* ヘルパで役割別）── 読取のみ・書込は関数/サービス ─
ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usage_daily_select" ON public.usage_daily;
CREATE POLICY "usage_daily_select" ON public.usage_daily
  FOR SELECT TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (public.auth_user_role() = 'tenant_admin' AND public.auth_user_tenant_id() = tenant_id)
    OR (store_id = ANY (public.auth_user_store_ids()))
  );

-- ── 4. 集計関数 refresh_usage_daily(from, to) ──────────────────────
-- 指定日付範囲（JST暦日）について usage_daily を再計算し upsert する。
-- 参考指標(video/footage)は運営(super_admin)の操作を除外（PR#213 非開示と整合）。
CREATE OR REPLACE FUNCTION public.refresh_usage_daily(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  WITH
  patrol AS (
    SELECT store_id, (created_at AT TIME ZONE 'Asia/Tokyo')::date AS d, count(*) AS c
    FROM public.patrol_runs
    WHERE (created_at AT TIME ZONE 'Asia/Tokyo')::date BETWEEN p_from AND p_to
    GROUP BY 1, 2
  ),
  alarm AS (
    SELECT store_id, (occurred_at AT TIME ZONE 'Asia/Tokyo')::date AS d, count(*) AS c
    FROM public.alarm_events
    WHERE (occurred_at AT TIME ZONE 'Asia/Tokyo')::date BETWEEN p_from AND p_to
    GROUP BY 1, 2
  ),
  insp AS (
    SELECT store_id, inspection_date AS d,
      count(*)                                                           AS total,
      count(*) FILTER (WHERE exit_at IS NOT NULL)                        AS exit_cnt,
      count(*) FILTER (WHERE confirmed_at IS NOT NULL)                   AS confirmed_cnt,
      count(*) FILTER (WHERE status = 'completed')                       AS matched,
      count(*) FILTER (WHERE status IN ('unmatched_entry','unmatched_exit')) AS unmatched
    FROM public.inspection_sessions
    WHERE inspection_date BETWEEN p_from AND p_to
    GROUP BY 1, 2
  ),
  video AS (
    SELECT ls.store_id, (ls.started_at AT TIME ZONE 'Asia/Tokyo')::date AS d, count(*) AS c
    FROM public.live_sessions ls
    LEFT JOIN public.admin_users au ON au.auth_user_id = ls.user_id
    WHERE (ls.started_at AT TIME ZONE 'Asia/Tokyo')::date BETWEEN p_from AND p_to
      AND coalesce(au.role, '') <> 'super_admin'
    GROUP BY 1, 2
  ),
  footage AS (
    SELECT fa.store_id, (fa.accessed_at AT TIME ZONE 'Asia/Tokyo')::date AS d, count(*) AS c
    FROM public.footage_access_log fa
    LEFT JOIN public.admin_users au ON au.auth_user_id = fa.actor_user_id
    WHERE (fa.accessed_at AT TIME ZONE 'Asia/Tokyo')::date BETWEEN p_from AND p_to
      AND coalesce(au.role, '') <> 'super_admin'
    GROUP BY 1, 2
  ),
  keys AS (
    SELECT store_id, d FROM patrol
    UNION SELECT store_id, d FROM alarm
    UNION SELECT store_id, d FROM insp
    UNION SELECT store_id, d FROM video
    UNION SELECT store_id, d FROM footage
  ),
  rows AS (
    SELECT
      s.id AS store_id, s.tenant_id, k.d AS date,
      coalesce(p.c, 0)             AS patrol_count,
      coalesce(a.c, 0)             AS alarm_count,
      coalesce(i.total, 0)         AS inspection_count,
      coalesce(i.exit_cnt, 0)      AS baggage_exit_count,
      coalesce(i.confirmed_cnt, 0) AS baggage_confirmed_count,
      coalesce(i.matched, 0)       AS face_auth_matched,
      coalesce(i.unmatched, 0)     AS face_auth_unmatched,
      coalesce(i.matched, 0) + coalesce(i.unmatched, 0) AS face_auth_attempts,
      coalesce(v.c, 0)             AS video_live_count,
      coalesce(f.c, 0)             AS footage_access_count
    FROM keys k
    JOIN public.stores s ON s.id = k.store_id
    LEFT JOIN patrol  p ON p.store_id = k.store_id AND p.d = k.d
    LEFT JOIN alarm   a ON a.store_id = k.store_id AND a.d = k.d
    LEFT JOIN insp    i ON i.store_id = k.store_id AND i.d = k.d
    LEFT JOIN video   v ON v.store_id = k.store_id AND v.d = k.d
    LEFT JOIN footage f ON f.store_id = k.store_id AND f.d = k.d
  )
  INSERT INTO public.usage_daily AS u (
    store_id, tenant_id, date, patrol_count, alarm_count, inspection_count,
    baggage_exit_count, baggage_confirmed_count, face_auth_matched, face_auth_unmatched,
    face_auth_attempts, video_live_count, footage_access_count, updated_at
  )
  SELECT store_id, tenant_id, date, patrol_count, alarm_count, inspection_count,
    baggage_exit_count, baggage_confirmed_count, face_auth_matched, face_auth_unmatched,
    face_auth_attempts, video_live_count, footage_access_count, now()
  FROM rows
  ON CONFLICT (store_id, date) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    patrol_count = EXCLUDED.patrol_count,
    alarm_count = EXCLUDED.alarm_count,
    inspection_count = EXCLUDED.inspection_count,
    baggage_exit_count = EXCLUDED.baggage_exit_count,
    baggage_confirmed_count = EXCLUDED.baggage_confirmed_count,
    face_auth_matched = EXCLUDED.face_auth_matched,
    face_auth_unmatched = EXCLUDED.face_auth_unmatched,
    face_auth_attempts = EXCLUDED.face_auth_attempts,
    video_live_count = EXCLUDED.video_live_count,
    footage_access_count = EXCLUDED.footage_access_count,
    updated_at = now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_usage_daily(date, date) FROM public, anon, authenticated;

-- ── 5. 読取RPC（結果件数が有界＝行取得上限を回避）───────────────────
-- スコープ: p_store_ids 非NULL → 担当店舗 / p_tenant 非NULL → テナント / どちらもNULL → 全件。
-- 呼び出し側(app)が resolveAdminContext で算出したスコープを渡す（サービスクライアント読取）。

-- 5-1. 店舗別サマリ（範囲合計・店舗数ぶんの行）
CREATE OR REPLACE FUNCTION public.usage_summary(
  p_from date, p_to date, p_tenant uuid, p_store_ids uuid[]
) RETURNS TABLE (
  store_id uuid, store_name text,
  patrol_count bigint, alarm_count bigint, inspection_count bigint,
  baggage_exit_count bigint, baggage_confirmed_count bigint,
  face_auth_matched bigint, face_auth_unmatched bigint, face_auth_attempts bigint,
  video_live_count bigint, footage_access_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.store_id, s.name,
    sum(u.patrol_count), sum(u.alarm_count), sum(u.inspection_count),
    sum(u.baggage_exit_count), sum(u.baggage_confirmed_count),
    sum(u.face_auth_matched), sum(u.face_auth_unmatched), sum(u.face_auth_attempts),
    sum(u.video_live_count), sum(u.footage_access_count)
  FROM public.usage_daily u JOIN public.stores s ON s.id = u.store_id
  WHERE u.date BETWEEN p_from AND p_to
    AND (p_store_ids IS NOT NULL AND u.store_id = ANY(p_store_ids)
         OR p_store_ids IS NULL AND p_tenant IS NOT NULL AND u.tenant_id = p_tenant
         OR p_store_ids IS NULL AND p_tenant IS NULL)
  GROUP BY u.store_id, s.name
  ORDER BY s.name;
$$;

-- 5-2. 曜日別（0=日〜6=土・最大7行）
CREATE OR REPLACE FUNCTION public.usage_weekday(
  p_from date, p_to date, p_tenant uuid, p_store_ids uuid[]
) RETURNS TABLE (
  dow int,
  patrol_count bigint, alarm_count bigint, inspection_count bigint,
  baggage_exit_count bigint, baggage_confirmed_count bigint, face_auth_attempts bigint,
  video_live_count bigint, footage_access_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT extract(dow from u.date)::int,
    sum(u.patrol_count), sum(u.alarm_count), sum(u.inspection_count),
    sum(u.baggage_exit_count), sum(u.baggage_confirmed_count), sum(u.face_auth_attempts),
    sum(u.video_live_count), sum(u.footage_access_count)
  FROM public.usage_daily u
  WHERE u.date BETWEEN p_from AND p_to
    AND (p_store_ids IS NOT NULL AND u.store_id = ANY(p_store_ids)
         OR p_store_ids IS NULL AND p_tenant IS NOT NULL AND u.tenant_id = p_tenant
         OR p_store_ids IS NULL AND p_tenant IS NULL)
  GROUP BY 1 ORDER BY 1;
$$;

-- 5-3. 月次推移（月頭日でグルーピング・月数ぶんの行）
CREATE OR REPLACE FUNCTION public.usage_trend(
  p_from date, p_to date, p_tenant uuid, p_store_ids uuid[]
) RETURNS TABLE (
  month date,
  patrol_count bigint, alarm_count bigint, inspection_count bigint,
  baggage_exit_count bigint, baggage_confirmed_count bigint, face_auth_attempts bigint,
  video_live_count bigint, footage_access_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc('month', u.date)::date,
    sum(u.patrol_count), sum(u.alarm_count), sum(u.inspection_count),
    sum(u.baggage_exit_count), sum(u.baggage_confirmed_count), sum(u.face_auth_attempts),
    sum(u.video_live_count), sum(u.footage_access_count)
  FROM public.usage_daily u
  WHERE u.date BETWEEN p_from AND p_to
    AND (p_store_ids IS NOT NULL AND u.store_id = ANY(p_store_ids)
         OR p_store_ids IS NULL AND p_tenant IS NOT NULL AND u.tenant_id = p_tenant
         OR p_store_ids IS NULL AND p_tenant IS NULL)
  GROUP BY 1 ORDER BY 1;
$$;

-- 読取RPCは admin ロールのみ（RLS 迂回の SECURITY DEFINER のため app 側でスコープ強制）。
REVOKE ALL ON FUNCTION public.usage_summary(date,date,uuid,uuid[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.usage_weekday(date,date,uuid,uuid[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.usage_trend(date,date,uuid,uuid[])   FROM public, anon;
