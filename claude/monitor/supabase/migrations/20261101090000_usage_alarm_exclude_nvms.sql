-- 月次の発報の数 (usage_daily.alarm_count) から G・VMS の機械の状態 (source='nvms') を外す。
--
-- node_down・node_up・recording_stopped・recording_resumed・disk_low は機械の状態で、
-- 現場の発報ではない。2026-10 は 586 件すべてがこれだった。通知と alarm_events の記録は残す。

CREATE OR REPLACE FUNCTION public.refresh_usage_daily(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
      AND source <> 'nvms'
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

-- 既に集計した行を数え直す。refresh_usage_daily は他の数も無い日の行を作り直さないので、
-- 全期間を refresh するだけでは、発報が nvms だけだった日の数が残る。
UPDATE public.usage_daily u
SET alarm_count = coalesce(a.c, 0), updated_at = now()
FROM public.usage_daily t
LEFT JOIN LATERAL (
  SELECT count(*) AS c
  FROM public.alarm_events e
  WHERE e.store_id = t.store_id
    AND (e.occurred_at AT TIME ZONE 'Asia/Tokyo')::date = t.date
    AND e.source <> 'nvms'
) a ON true
WHERE u.store_id = t.store_id AND u.date = t.date
  AND u.alarm_count IS DISTINCT FROM coalesce(a.c, 0);

REVOKE ALL ON FUNCTION public.refresh_usage_daily(date, date) FROM public, anon, authenticated;
