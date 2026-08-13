-- NVR 時計ズレを**拠点数に耐える形**で見えるようにする（段階0）。
--
-- ── なぜ要るのか ──────────────────────────────────────────────────────────
-- BCP スナップショット・発報前コマ・検査クリップは、いずれも NVR の
-- タイムラインから切り出す。**NVR の時計ズレは、そのまま証跡の時刻ズレになる**
-- （実例: NTP 未設定で +3 分。util/nvr-clock.ts の説明を参照）。
--
-- 現場の NVR は NTP が揃っていない。100 拠点規模では、今のつくりでは足りない:
--
--   ・最新値しか持たない      → 「その映像を撮った時点で何秒ずれていたか」を
--                               後から再現できない
--   ・エッジ詳細ページのみ    → 1 台ずつ開かないと分からない。100 拠点では無理
--   ・証跡に残るのは検査のみ  → BCP・発報は監査も遡及補正もできない
--
-- ここで足すのは 3 つ。**補正はまだしない**（段階1）。まず現状を測る。

-- ① 時刻差の履歴。分布とドリフトを見るため、そして「録画時点のズレ」を
--    後から引けるようにするため。
create table if not exists public.nvr_clock_samples (
  id            bigserial   primary key,
  edge_id       uuid        not null references public.edge_devices(id) on delete cascade,
  /** 測った相手（1 エッジに複数レコーダがありうる）。 */
  recorder_host text,
  /** 正 = NVR が進んでいる。HTTP Date ヘッダ由来なので 1 秒粒度。 */
  offset_sec    integer     not null,
  measured_at   timestamptz not null default now()
);

comment on table public.nvr_clock_samples is
  'NVR 時計ズレの実測履歴。証跡の時刻精度の根拠であり、遡及補正の材料。';

create index if not exists nvr_clock_samples_edge_time_idx
  on public.nvr_clock_samples (edge_id, measured_at desc);

alter table public.nvr_clock_samples enable row level security;

-- 運用データなので super_admin のみ。書き込みポリシーは置かない
-- （エッジは service_role で書く）。
drop policy if exists nvr_clock_samples_select on public.nvr_clock_samples;
create policy nvr_clock_samples_select on public.nvr_clock_samples
  for select to authenticated
  using (public.auth_user_role() = 'super_admin');

-- ② 証跡に「撮った時点のズレ」を刻む。検査クリップには既にあるので、
--    BCP と発報にも同じものを足す。**列が無ければ、その映像が何秒ずれて
--    いたかを永久に再現できない。**
alter table public.bcp_clips    add column if not exists clock_offset_sec integer;
alter table public.alarm_frames add column if not exists clock_offset_sec integer;

comment on column public.bcp_clips.clock_offset_sec is
  '切り出し時に実測した NVR 時計ズレ（秒・正=NVR が進んでいる）。null=未計測。';
comment on column public.alarm_frames.clock_offset_sec is
  '取得時に実測した NVR 時計ズレ（秒・正=NVR が進んでいる）。null=未計測。';

-- ③ 艦隊全体の集計。**1 台ずつ開かずに済むように。**
--    判断（しきい値・深刻度）は呼び出し側（src/lib/ops/nvr-clock.ts）。
--    ここは事実だけ返す（partition_health / schema_invariants と同じ分け方）。
create or replace function public.nvr_clock_fleet(
  p_warn_sec    integer default 10,
  p_stale_hours integer default 6,
  p_limit       integer default 20
)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
stable
as $$
  with e as (
    select d.id, d.name as edge_name, s.name as store_name,
           d.nvr_clock_offset_sec as offset_sec, d.nvr_clock_checked_at as checked_at
      from public.edge_devices d
      left join public.stores s on s.id = d.store_id
     -- 退役した端末を数えない。offline も「測れていない」ものとして扱う
     -- （測定は 30 分毎なので、生きていれば値が付く）。
     where d.status is distinct from 'retired'
  )
  select jsonb_build_object(
    'checked_at',      now(),
    'warn_sec',        p_warn_sec,
    'stale_hours',     p_stale_hours,
    'edges',           (select count(*) from e),
    -- 一度も測れていない＝NVR に届いていないか、エッジが古い版
    'never_measured',  (select count(*) from e where checked_at is null),
    -- 測ったが古い＝30 分毎のはずが止まっている
    'stale',           (select count(*) from e
                         where checked_at is not null
                           and checked_at < now() - make_interval(hours => p_stale_hours)),
    'over_threshold',  (select count(*) from e
                         where offset_sec is not null and abs(offset_sec) >= p_warn_sec),
    'max_abs_sec',     coalesce((select max(abs(offset_sec)) from e where offset_sec is not null), 0),
    -- 悪い順に上位だけ。100 拠点ぶん並べるとメールが読めなくなる。
    'worst',           coalesce((
      select jsonb_agg(x order by x->>'abs_sec' desc)
        from (
          select jsonb_build_object(
                   'store',      coalesce(store_name, '(店舗未設定)'),
                   'edge',       coalesce(edge_name, id::text),
                   'offset_sec', offset_sec,
                   'abs_sec',    abs(offset_sec),
                   'checked_at', checked_at
                 ) as x
            from e
           where offset_sec is not null and abs(offset_sec) >= p_warn_sec
           order by abs(offset_sec) desc
           limit p_limit
        ) t), '[]'::jsonb)
  );
$$;

comment on function public.nvr_clock_fleet(integer, integer, integer) is
  'NVR 時計ズレの艦隊集計（事実のみ）。判断は src/lib/ops/nvr-clock.ts。';

-- ④ 履歴の記録（エッジから service_role で呼ぶ）。90 日で掃除する。
create or replace function public.record_nvr_clock_sample(
  p_edge_id       uuid,
  p_offset_sec    integer,
  p_recorder_host text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
declare
  v_id bigint;
begin
  insert into public.nvr_clock_samples (edge_id, offset_sec, recorder_host)
  values (p_edge_id, p_offset_sec, p_recorder_host)
  returning id into v_id;

  -- 30 分毎 × 100 拠点 = 1 日 4,800 行。90 日で約 43 万行なので、
  -- 索引付きの表としては十分小さい。
  delete from public.nvr_clock_samples where measured_at < now() - interval '90 days';

  return v_id;
end;
$$;

revoke all on function public.nvr_clock_fleet(integer, integer, integer) from public;
revoke all on function public.record_nvr_clock_sample(uuid, integer, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.nvr_clock_fleet(integer, integer, integer) from anon';
    execute 'revoke all on function public.record_nvr_clock_sample(uuid, integer, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.nvr_clock_fleet(integer, integer, integer) from authenticated';
    execute 'revoke all on function public.record_nvr_clock_sample(uuid, integer, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.nvr_clock_fleet(integer, integer, integer) to service_role';
    execute 'grant execute on function public.record_nvr_clock_sample(uuid, integer, text) to service_role';
  end if;
end $$;
