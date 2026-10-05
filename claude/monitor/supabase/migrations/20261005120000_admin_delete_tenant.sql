-- テナントの削除 (運営・super_admin)。2026-10-05
--
-- これまで削除は提供していなかった (配下の拠点・ユーザ・エッジを所有するため、
-- 誤削除の被害が大きい)。デモや試用で作ったテナントを片付けられないので、
-- 安全策を付けたうえで消せるようにする。安全策のうち「停止 (suspended) にしたものだけ」
-- と「名前の打ち込み」は API (api/admin/tenants/[id]) が見る。ここは消す本体。
--
-- **素の DELETE FROM tenants は通らない。** tenants → stores は CASCADE だが、
-- stores・recorder_cameras・bcp_events・patrol_runs を ON DELETE 指定なし (NO ACTION) で
-- 参照する表が 12 個あり、記録が 1 件でもあると止まる。それらを深い順に先に消してから
-- テナントを消す。外部キーの無い表 (enrollment_tokens・licenses・baggage_kiosk_pins・
-- live_sessions・monitor_results) は自動では消えないので、ここで明示的に消す。
--
-- **全部消えるか、何も消えないか。** 1 つの関数 = 1 つのトランザクションで行う。
-- 途中で失敗すれば全体が巻き戻る (半端に消えたテナントを作らない)。
--
-- ここで消さないもの (API が後で行う):
--   - ログイン用のアカウント (auth.users)。admin_users / edge_devices の行は CASCADE で
--     消えるが、auth 側は外部キーが無く残る。API が消す前に集めて、消したあとに削除する
--   - Storage のファイル。DB の行を消すと場所が分からなくなるので、API が先に集める
--
-- 戻り値: 消した行数 (表ごと)。監査ログと画面の表示に使う。
-- service_role のみ実行可 (画面から直接は呼べない)。

create or replace function public.admin_delete_tenant(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
declare
  v_stores  uuid[];
  v_edges   uuid[];
  v_cams    uuid[];
  v_counts  jsonb := '{}'::jsonb;
  n         bigint;
begin
  -- 同じテナントを同時に 2 回消しに来ても、片方は待ってから「無い」で終わる
  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(id), '{}') into v_stores
    from public.stores where tenant_id = p_tenant_id;
  select coalesce(array_agg(id), '{}') into v_edges
    from public.edge_devices where store_id = any(v_stores);
  select coalesce(array_agg(rc.id), '{}') into v_cams
    from public.recorder_cameras rc
    join public.recorders r on r.id = rc.recorder_id
   where r.edge_id = any(v_edges);

  -- ---- NO ACTION で止める記録を深い順に消す ----------------------------------
  delete from public.alarm_frames
   where camera_id = any(v_cams)
      or alarm_event_id in (select id from public.alarm_events
                             where store_id = any(v_stores) or camera_id = any(v_cams));
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('alarm_frames', n);

  delete from public.alarm_events where store_id = any(v_stores) or camera_id = any(v_cams);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('alarm_events', n);

  delete from public.alarm_settings where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('alarm_settings', n);

  delete from public.bcp_clips
   where event_id in (select id from public.bcp_events where store_id = any(v_stores));
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('bcp_clips', n);

  delete from public.bcp_reports
   where event_id in (select id from public.bcp_events where store_id = any(v_stores));
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('bcp_reports', n);

  -- bcp_grid_shots は bcp_events から CASCADE で消える
  delete from public.bcp_events where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('bcp_events', n);

  delete from public.bcp_settings where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('bcp_settings', n);

  delete from public.patrol_findings
   where run_id in (select id from public.patrol_runs where store_id = any(v_stores));
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('patrol_findings', n);

  delete from public.patrol_runs where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('patrol_runs', n);

  delete from public.monitor_checks where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('monitor_checks', n);

  delete from public.monitor_daily_stats where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('monitor_daily_stats', n);

  delete from public.monitor_incidents where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('monitor_incidents', n);

  delete from public.monitor_reports where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('monitor_reports', n);

  delete from public.monitor_settings where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('monitor_settings', n);

  delete from public.security_reports where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('security_reports', n);

  delete from public.security_settings where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('security_settings', n);

  -- ---- 外部キーの無い表 (自動では消えない) -------------------------------------
  delete from public.live_sessions where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('live_sessions', n);

  delete from public.monitor_results where store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('monitor_results', n);

  delete from public.enrollment_tokens where tenant_id = p_tenant_id or store_id = any(v_stores);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('enrollment_tokens', n);

  delete from public.licenses where tenant_id = p_tenant_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('licenses', n);

  delete from public.baggage_kiosk_pins where tenant_id = p_tenant_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('baggage_kiosk_pins', n);

  -- ---- 本体 (拠点・ユーザ・エッジ・レコーダ・カメラなどは CASCADE で消える) ---------
  v_counts := v_counts || jsonb_build_object(
    'stores',           coalesce(array_length(v_stores, 1), 0),
    'edge_devices',     coalesce(array_length(v_edges, 1), 0),
    'recorder_cameras', coalesce(array_length(v_cams, 1), 0),
    'admin_users',      (select count(*) from public.admin_users where tenant_id = p_tenant_id)
  );
  delete from public.tenants where id = p_tenant_id;

  return v_counts;
end;
$$;

comment on function public.admin_delete_tenant(uuid) is
  'テナントを配下ごと 1 トランザクションで削除する (運営)。auth.users と Storage は呼び出し側 (API) が消す。service_role のみ。';

revoke all on function public.admin_delete_tenant(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.admin_delete_tenant(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.admin_delete_tenant(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.admin_delete_tenant(uuid) to service_role';
  end if;
end $$;
