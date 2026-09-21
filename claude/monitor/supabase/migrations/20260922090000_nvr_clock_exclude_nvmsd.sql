-- NVR 時計点検から nvmsd アップリンクを除外する。
--
-- ── 何が起きたか ────────────────────────────────────────────────────────
-- 2026-09-22 の日次点検が「NVR 時計を一度も測れていない拠点が 1/3 台」を出した。
-- 中身は `nvmsd-uplink-検証`（agent `nvmsd/0.1.62`）で、これは**エッジ箱ではなく
-- G・VMS 本体のアップリンク**。NVR 時計の実測は edge-agent（別コード）の機能で、
-- nvmsd は「測る対象の外部 NVR」を持たない（自分が録画機）。したがって
-- `nvr_clock_checked_at` は永遠に NULL のまま＝毎日この誤検出が鳴り、本物の
-- 未測定が埋もれる。
--
-- ── 直し方 ──────────────────────────────────────────────────────────────
-- bootstrap / OTA 点検が agent_version の `nvmsd/` プレフィックスで内蔵アップリンクを
-- 除外しているのと同じ扱いを、この艦隊集計にも入れる。判断側
-- (src/lib/ops/nvr-clock.ts) は変更しない — 事実の母集団から nvmsd を外すだけ。
--
-- 注: nvms（G・VMS 録画機）の時計精度そのものは別問題。将来 nvmsd が自分の
--     NTP 同期状態を health で報告する余地はあるが、本 migration の範囲外。
--     ここでは「edge-agent が外部 NVR を測る」点検の母集団を正すだけ。

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
       -- nvmsd 内蔵アップリンクは外部 NVR を測らない（自分が録画機）。母集団から外す。
       and (d.agent_version is null or d.agent_version not like 'nvmsd/%')
  )
  select jsonb_build_object(
    'checked_at',      now(),
    'warn_sec',        p_warn_sec,
    'stale_hours',     p_stale_hours,
    'edges',           (select count(*) from e),
    'never_measured',  (select count(*) from e where checked_at is null),
    'stale',           (select count(*) from e
                         where checked_at is not null
                           and checked_at < now() - make_interval(hours => p_stale_hours)),
    'over_threshold',  (select count(*) from e
                         where offset_sec is not null and abs(offset_sec) >= p_warn_sec),
    'max_abs_sec',     coalesce((select max(abs(offset_sec)) from e where offset_sec is not null), 0),
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
  'NVR 時計ズレの艦隊集計（事実のみ・nvmsd アップリンクは母集団から除外）。判断は src/lib/ops/nvr-clock.ts。';

-- security definer + 明示 search_path は維持（リストア時に search_path 未固定だと
-- 落ちる既知の罠のため）。grant は CREATE OR REPLACE で保持される。
