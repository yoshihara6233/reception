-- 証跡の取りこぼしを見えるようにする（外部レビュー指摘 #6）。
--
-- ── 何が起きうるか ────────────────────────────────────────────────────────
-- エッジは `edge_devices.pending_command` を 500ms 間隔で読み、**実行より先に
-- クリア**して、実処理は detached で走らせる（`realtime.ts` / `state-machine.ts`）。
-- これは意図的で、BCP は最大 30 分かかるため、待つとその間ライブ視聴が止まる。
--
-- 代償として、拾った直後にエージェントが落ちると**命令はどこにも残らない**。
-- `lastRequestId` はメモリ上なので再起動後の再生も無い。
--
-- 発報側はさらに悪い連鎖になる:
--   1. クラウドが pending_command に書く
--   2. **同時に** alarm_events.timeline_dispatched_at を now() で埋める
--   3. エッジが拾ってクリア → 落ちる（命令は消える）
--   4. リトライ cron は `timeline_dispatched_at IS NULL` の発報だけ再送する
--      → **二度と再送されない**
--   5. 結果: 前後スナップが 1 枚も無い発報が残るが、記録上は「送信済み」
--
-- つまり **撮れていないのに、どの列を見ても正常に見える**。
--
-- ── ここで足すもの ────────────────────────────────────────────────────────
--   ① edge_command_runs … エッジが命令を**受け取ったこと**の記録。
--      「届かなかった」と「届いたが撮れなかった」を切り分けるために要る。
--   ② evidence_gaps()   … 取得を指示したのに証跡が来ていないものを数える。
--      日次点検（partition-health）から鳴らす。判断は TS 側。

-- ① 命令の受領記録。
--
-- ⚠ **`ok=true` は「撮れた」ではない。**証跡の実処理は detached で走るので、
--   ここに書けるのは「ハンドラを起動できたか」まで。撮れたかどうかは
--   証跡そのもの（bcp_clips / alarm_frames）を見る＝ evidence_gaps() の仕事。
--   ok=false は起動時点の失敗（未知のカメラ・設定不備など）を捕まえる。
create table if not exists public.edge_command_runs (
  request_id  uuid        primary key,
  edge_id     uuid        not null references public.edge_devices(id) on delete cascade,
  action      text        not null,
  claimed_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  error       text
);

comment on table public.edge_command_runs is
  'エッジが pending_command を受け取った記録。ok は「ハンドラを起動できたか」であって「撮れたか」ではない（証跡の実処理は detached）。';

create index if not exists edge_command_runs_edge_time_idx
  on public.edge_command_runs (edge_id, claimed_at desc);

alter table public.edge_command_runs enable row level security;

-- 閲覧は super_admin のみ（運用データ）。
drop policy if exists edge_command_runs_admin_select on public.edge_command_runs;
create policy edge_command_runs_admin_select on public.edge_command_runs
  for select to authenticated
  using (public.auth_user_role() = 'super_admin');

-- エッジは自分の行だけ書ける（Phase B1 と同じ、JWT から信じるのは edge_id だけ）。
drop policy if exists edge_command_runs_edge_insert on public.edge_command_runs;
create policy edge_command_runs_edge_insert on public.edge_command_runs
  for insert to authenticated
  with check (((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid) = edge_id);

drop policy if exists edge_command_runs_edge_update on public.edge_command_runs;
create policy edge_command_runs_edge_update on public.edge_command_runs
  for update to authenticated
  using      (((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid) = edge_id)
  with check (((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid) = edge_id);

-- ② 証跡の取りこぼし。事実だけ返す（判断は src/lib/ops/evidence-gaps.ts）。
--
-- 【猶予の取り方】一律の猶予にしない。**BCP は +30 分オフセットまである**ので、
--   発生直後に一律で判定すると、まだ撮る時刻が来ていない行を「欠落」と誤検知する。
--   誤検知が続く通知は読まれなくなり、結果として本物も見落とす。
--   そこで clip ごとに `created_at + offset_min 分 + 猶予` で判定する。
--
-- 【対象期間】直近 p_days 日だけを警報対象にする。全期間を対象にすると、
--   検査を入れた初日に過去の全欠落が一度に出て、行動につながらない。
--   過去分は `older` として件数だけ返す。
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
       and not exists (
             select 1 from public.alarm_frames f
              where f.alarm_event_id = a.id and f.status = 'completed')
  ),
  -- BCP: プレースホルダのまま埋まっていない clip。
  -- 撮る時刻（created_at + offset_min）を過ぎてから猶予を数える。
  bcp_gap as (
    select c.id, c.event_id, c.created_at, c.offset_min, s.name as store_name,
           c.created_at
             + make_interval(mins => greatest(coalesce(c.offset_min, 0), 0))
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
  '取得を指示したのに届いていない証跡（発報の前後スナップ・BCP クリップ）の集計。事実のみ。判断は src/lib/ops/evidence-gaps.ts。';

-- ③ 掃除。
--
-- ⚠ エッジ側は **RPC ではなく表への直接 insert/update** で書く。
--   Phase B4 でエッジは service_role ではなく**スコープ付きの authenticated
--   トークン**になるため、service_role 限定の SECURITY DEFINER 関数は呼べない。
--   上の RLS ポリシー（JWT の edge_id 一致）が両モードで効く形にしてある
--   （非スコープ運用の service_role は RLS を素通りするので、こちらも動く）。
--   よって掃除だけを関数に切り出し、日次の cleanup cron から呼ぶ。
create or replace function public.prune_edge_command_runs(p_days integer default 14)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
declare
  v_deleted integer;
begin
  -- 100 拠点 × 数百命令/日 で 14 日なら数十万行。索引付きなら十分小さい。
  delete from public.edge_command_runs
   where claimed_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.evidence_gaps(integer, integer, integer) from public;
revoke all on function public.prune_edge_command_runs(integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.evidence_gaps(integer, integer, integer) from %I', r);
      execute format('revoke all on function public.prune_edge_command_runs(integer) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.evidence_gaps(integer, integer, integer) to service_role';
    execute 'grant execute on function public.prune_edge_command_runs(integer) to service_role';
  end if;
end $$;
