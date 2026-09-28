-- evidence_gaps(): G・VMS の重大イベント (alarm_events.source = 'nvms') を証跡の点検から外す (2026-09-28)。
--
-- G・VMS の拠点は POST /api/edge/events で重大イベント (サーバの停止・復帰など・カメラ非依存) を上げ、
-- クラウドはそれを alarm_events に記録する。拾い直しの cron (alarm-dispatch-retry) が出どころを見ずに
-- capture_alarm_timeline を送り、G・VMS は対応していないので読み飛ばす。その結果「送信済みなのに
-- 前後スナップが 1 枚も無い」として毎日の点検が欠落に数え、誤った警報を出していた。
-- 本文は 20260813130000 の関数に、alarm_gap の条件を 1 行足しただけ。

create or replace function public.evidence_gaps(
  p_days          integer default 7,
  p_grace_minutes integer default 30,
  p_limit         integer default 10
)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
stable
as $$
  with
  -- 発報: 「送った」記録があるのに、**使える**前後スナップが 1 枚も無いもの。
  -- 発報のオフセットは秒（最大 +180 秒）なので、猶予は固定で足りる。
  --
  -- ⚠ 「行が 0 件か」ではなく「completed が 0 件か」で見る。alarm_frames は
  --   自前の status(pending/completed/failed) を持つので、行の有無だけだと
  --   **届いたが全部 failed** を正常として見逃す。
  alarm_gap as (
    select a.id, a.occurred_at, a.timeline_dispatched_at, s.name as store_name
      from public.alarm_events a
      left join public.stores s on s.id = a.store_id
     where a.timeline_dispatched_at is not null
       and a.timeline_dispatched_at < now() - make_interval(mins => p_grace_minutes)
       -- G・VMS の重大イベント (source='nvms') はカメラの発報ではなく、前後スナップを撮らない。
       -- 以前は拾い直しの cron が指示を送り、G・VMS が読み飛ばして欠落に数えられていた
       -- (2026-09-26 の 6 件)。cron 側も送らないように直した (lib/alarms/dispatch.ts)
       and a.source <> 'nvms'
       and not exists (
             select 1 from public.alarm_frames f
              where f.alarm_event_id = a.id and f.status = 'completed')
  ),
  -- BCP: プレースホルダのまま埋まっていない clip。
  -- 撮る時刻（created_at + offset_min）を過ぎてから猶予を数える。
  bcp_gap as (
    select c.id, c.event_id, c.created_at, c.offset_min, s.name as store_name,
           c.created_at
             -- ⚠ offset_min が NULL の行を **0 分**として扱わない。
             --   これは「旧・動画クリップ」ではなく、発令時に作られる
             --   **カメラ単位のプレースホルダ**で、エッジは全オフセットの撮影を
             --   終えてから削除する（edge-agent/src/modes/bcp.ts の
             --   placeholder cleanup・2026-06-27 の是正）。
             --   0 とみなすと、+30 分のコマを含む撮影の最中に、まだ正常な
             --   プレースホルダを欠落と数える窓ができる。日次なので当たる確率は
             --   低いが、**たまにしか出ない誤検知が一番たちが悪い**
             --   （原因が分からず、そのうち通知ごと無視される）。
             --   30 は bcp_settings_snapshot_offsets_chk が許す最大オフセット。
             + make_interval(mins => greatest(coalesce(c.offset_min, 30), 0))
             + make_interval(mins => p_grace_minutes) as due_at
      from public.bcp_clips c
      left join public.bcp_events e on e.id = c.event_id
      left join public.stores s on s.id = e.store_id
     where c.upload_status = 'pending'
  )
  select jsonb_build_object(
    'checked_at',    now(),
    'days',          p_days,
    'grace_minutes', p_grace_minutes,
    'alarms', jsonb_build_object(
      'recent', (select count(*) from alarm_gap
                  where timeline_dispatched_at >= now() - make_interval(days => p_days)),
      'older',  (select count(*) from alarm_gap
                  where timeline_dispatched_at <  now() - make_interval(days => p_days)),
      'worst',  coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object(
                   'store',       coalesce(store_name, '(店舗不明)'),
                   'occurred_at', occurred_at
                 ) as x
            from alarm_gap
           where timeline_dispatched_at >= now() - make_interval(days => p_days)
           order by occurred_at desc
           limit p_limit
        ) t), '[]'::jsonb)
    ),
    'bcp', jsonb_build_object(
      'recent', (select count(*) from bcp_gap
                  where due_at < now() and created_at >= now() - make_interval(days => p_days)),
      'older',  (select count(*) from bcp_gap
                  where due_at < now() and created_at <  now() - make_interval(days => p_days)),
      -- まだ撮る時刻が来ていないもの（正常）。誤検知していないことを示すために返す。
      'not_due', (select count(*) from bcp_gap where due_at >= now()),
      'worst',  coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object(
                   'store',      coalesce(store_name, '(店舗不明)'),
                   'event_id',   event_id,
                   'offset_min', offset_min,
                   'created_at', created_at
                 ) as x
            from bcp_gap
           where due_at < now() and created_at >= now() - make_interval(days => p_days)
           order by created_at desc
           limit p_limit
        ) t), '[]'::jsonb)
    )
  );
$$;

comment on function public.evidence_gaps(integer, integer, integer) is
  '取得を指示したのに届いていない証跡の集計（事実のみ）。判断は src/lib/ops/evidence-gaps.ts。';
revoke all on function public.evidence_gaps(integer, integer, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.evidence_gaps(integer, integer, integer) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.evidence_gaps(integer, integer, integer) to service_role';
  end if;
end $$;
