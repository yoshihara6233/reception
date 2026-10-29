-- 書き込みのポリシーを「担当の範囲」に絞る（2026-10-28 自主診断 ASVS 8.2.1・8.2.2・15.3.3）。
--
-- これまでの形には 2 つの抜けがあった:
--
--  1. `*_modify` の多くが FOR ALL で「役割だけ」を見ていた（店舗・テナントを見ない）。
--     permissive なポリシーは OR で効くので、FOR ALL は SELECT にも効く。
--     つまり**別テナントの店長・テナント管理者が、他テナントの行を読み書きできた**。
--
--  2. edges_modify / recorders_modify / cameras_modify は逆に「見えるかどうか」だけを
--     見ていた（役割を見ない）。**閲覧の利用者でも自店舗の機器の行を書き換えられた**。
--     画面と API は requireSuperAdmin / requireAdmin で止めていたが、PostgREST を
--     直接呼ぶと DB のポリシーだけが守りになる。
--
-- 直し方: 書き込み（INSERT / UPDATE / DELETE）を FOR ALL から切り離し、
--   「管理の役割であること」と「その店舗を担当していること」の両方を求める。
--   読み取りはそれぞれの *_select ポリシーがすでに店舗・テナントで絞っているので、
--   FOR ALL を外せば余分な読み取りの経路も消える。
--
-- 担当の範囲は可視性（*_select）と同じ形にそろえる:
--   super_admin          … 全店舗
--   tenant_admin         … 自テナントの店舗
--   store_manager        … store_ids の店舗
--   viewer / baggage_manager … 書けない（これまでも *_modify の役割に入っていない）
--
-- サービスの接続（service_role）は RLS を通らないので、エッジの受け口・cron・
-- 通知の書き込みには影響しない。

-- ── 判定の関数 ────────────────────────────────────────────────────────
create or replace function public.can_manage_store(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_store is not null and exists (
    select 1 from public.admin_users u
     where u.auth_user_id = auth.uid()
       and (
         u.role = 'super_admin'
         or (u.role = 'tenant_admin'
             and exists (select 1 from public.stores s
                          where s.id = p_store and s.tenant_id = u.tenant_id))
         or (u.role = 'store_manager'
             and p_store = any (coalesce(u.store_ids, '{}'::uuid[])))
       )
  )
$$;
comment on function public.can_manage_store(uuid) is
  '書き込みの担当範囲: super_admin=全店舗・tenant_admin=自テナント・store_manager=store_ids。それ以外は偽。';
revoke all on function public.can_manage_store(uuid) from public;
grant execute on function public.can_manage_store(uuid) to authenticated;

-- 親の行から店舗を引く（RLS を通らずに引くため security definer。返すのは店舗の ID だけ）。
create or replace function public.store_of_edge(p_edge uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select store_id from public.edge_devices where id = p_edge
$$;
create or replace function public.store_of_recorder(p_recorder uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select e.store_id from public.recorders r join public.edge_devices e on e.id = r.edge_id
   where r.id = p_recorder
$$;
create or replace function public.store_of_camera(p_camera uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select e.store_id from public.recorder_cameras c
    join public.recorders r on r.id = c.recorder_id
    join public.edge_devices e on e.id = r.edge_id
   where c.id = p_camera
$$;
create or replace function public.store_of_alarm_event(p_event uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select store_id from public.alarm_events where id = p_event
$$;
create or replace function public.store_of_bcp_event(p_event uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select store_id from public.bcp_events where id = p_event
$$;
create or replace function public.store_of_patrol_run(p_run uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select store_id from public.patrol_runs where id = p_run
$$;
do $$
declare f text;
begin
  foreach f in array array['store_of_edge','store_of_recorder','store_of_camera',
                           'store_of_alarm_event','store_of_bcp_event','store_of_patrol_run'] loop
    execute format('revoke all on function public.%I(uuid) from public', f);
    execute format('grant execute on function public.%I(uuid) to authenticated', f);
  end loop;
end $$;

-- ── 店舗の列を持つ表・親から店舗を引く表 ────────────────────────────────
-- (表, 古い FOR ALL のポリシー名, 店舗を表す式)
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('alarm_events',           'alarm_events_modify',           'store_id'),
      ('alarm_settings',         'alarm_settings_modify',         'store_id'),
      ('bcp_events',             'bcp_events_modify',             'store_id'),
      ('bcp_settings',           'bcp_settings_modify',           'store_id'),
      ('monitor_checks',         'monitor_checks_modify',         'store_id'),
      ('monitor_daily_stats',    'monitor_daily_stats_modify',    'store_id'),
      ('monitor_incidents',      'monitor_incidents_modify',      'store_id'),
      ('monitor_reports',        'monitor_reports_modify',        'store_id'),
      ('monitor_results',        'monitor_results_modify',        'store_id'),
      ('monitor_settings',       'monitor_settings_modify',       'store_id'),
      ('patrol_runs',            'patrol_runs_modify',            'store_id'),
      ('security_reports',       'security_reports_modify',       'store_id'),
      ('security_settings',      'security_settings_modify',      'store_id'),
      ('alarm_frames',           'alarm_frames_modify',           'public.store_of_alarm_event(alarm_event_id)'),
      ('bcp_clips',              'bcp_clips_modify',              'public.store_of_bcp_event(event_id)'),
      ('bcp_grid_shots',         'bcp_grid_shots_modify',         'public.store_of_bcp_event(event_id)'),
      ('bcp_reports',            'bcp_reports_modify',            'public.store_of_bcp_event(event_id)'),
      ('patrol_findings',        'patrol_findings_modify',        'public.store_of_patrol_run(run_id)'),
      ('security_camera_config', 'security_camera_config_modify', 'public.store_of_camera(camera_id)'),
      ('recorders',              'recorders_modify',              'public.store_of_edge(edge_id)'),
      ('recorder_cameras',       'cameras_modify',                'public.store_of_recorder(recorder_id)')
    ) as t(tbl, old_policy, store_expr)
  loop
    execute format('drop policy if exists %I on public.%I', r.old_policy, r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_admin_insert', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_admin_update', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_admin_delete', r.tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_manage_store(%s))',
      r.tbl || '_admin_insert', r.tbl, r.store_expr);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_manage_store(%s)) with check (public.can_manage_store(%s))',
      r.tbl || '_admin_update', r.tbl, r.store_expr, r.store_expr);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_manage_store(%s))',
      r.tbl || '_admin_delete', r.tbl, r.store_expr);
  end loop;
end $$;

-- ── edge_devices: 書くのは運営（super_admin）だけ ─────────────────────────
-- 画面と API で edge_devices を書くのは requireSuperAdmin の経路だけ（登録・設定・
-- 版の昇格・削除）。それ以外の書き込みはエッジの受け口と cron がサービスの接続で行う。
-- エッジ自身のトークンの UPDATE は edge_devices_edge_update と
-- trg_edges_edge_token_guard（自己申告の列だけ）のまま残す。
drop policy if exists edges_modify on public.edge_devices;
drop policy if exists edge_devices_admin_insert on public.edge_devices;
drop policy if exists edge_devices_admin_update on public.edge_devices;
drop policy if exists edge_devices_admin_delete on public.edge_devices;
create policy edge_devices_admin_insert on public.edge_devices
  for insert to authenticated with check (public.auth_user_role() = 'super_admin');
create policy edge_devices_admin_update on public.edge_devices
  for update to authenticated
  using (public.auth_user_role() = 'super_admin')
  with check (public.auth_user_role() = 'super_admin');
create policy edge_devices_admin_delete on public.edge_devices
  for delete to authenticated using (public.auth_user_role() = 'super_admin');

-- 機器の認証の列は、利用者の接続からは作った後に変えさせない（運営の画面も変えない）。
-- 変えるのはエンロールと初回の受け口（サービスの接続）だけ。
create or replace function public.edge_devices_guard_auth_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if new.device_token_hash is distinct from old.device_token_hash
     or new.auth_user_id is distinct from old.auth_user_id
     or new.auth_password_enc is distinct from old.auth_password_enc then
    raise exception 'edge auth columns are managed by the server only'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
comment on function public.edge_devices_guard_auth_columns() is
  '利用者の接続（authenticated）からの device_token_hash・auth_user_id・auth_password_enc の変更を断る。';

drop trigger if exists trg_edges_auth_columns_guard on public.edge_devices;
create trigger trg_edges_auth_columns_guard
  before update on public.edge_devices
  for each row execute function public.edge_devices_guard_auth_columns();
