-- 認可とデータの範囲の残り (2026-10-30・自主診断 ASVS 2.2.3・8.2.3・8.3.1・8.4.1)。
--
-- 20261028120000_rls_write_scope.sql で書き込みを「管理の役割 × 担当の店舗」に絞った。
-- その後に残っていたのは、PostgREST を利用者のトークンで直接呼んだときに
-- 「画面と API では守っている規則」を DB が知らない所:
--
--   1. 関連する列の組み合わせ (2.2.3)
--      行の店舗は担当の範囲でも、カメラ・録画機・検査の記録の列に**別の店舗のもの**を入れられた
--      (発報・発報のコマ・BCP のクリップ・BCP のグリッド・巡回の所見・検査のクリップ)。
--      エッジのトークン (エッジ用のポリシー) も同じ。
--   2. 役割だけ・テナントだけを見る書き込みのポリシー (2.2.3・8.4.1)
--      - metric_events_insert: 利用者なら誰でも、別テナントの店舗の計測を作れた。
--        書くのはサーバ (service_role・lib/metrics.ts) だけなので、利用者向けを外す。
--      - licenses_modify: テナントの管理者が、別テナントのエッジを指すライセンスの行を作れた。
--        書くのは API (/api/admin/licenses・service_role) だけなので、利用者向けの書き込みを外す。
--   3. 店舗の行 (8.2.3)
--      - stores_update: 店長が自テナントのどの店舗の行も、どの列も書き換えられた
--        (有料オプション opt_* を含む)。店長は担当の店舗 (store_ids) だけにし、
--        opt_* と tenant_id は API と同じ規則をトリガで強制する。
--   4. 利用者のトークンで呼べる SECURITY DEFINER の関数 (8.3.1・8.4.1)
--      - start_live_session: 店舗が見えるかを関数の中で見ていなかった (API が先に見ていた)。
--        直接呼ぶと、別テナントの店舗に視聴の記録を作り、そのテナントの同時視聴の枠を使えた。
--      - cron とサーバだけが使う関数 (BCP の報告の起動・J-Alert の起動・利用の集計・
--        受付の未退出の検出) が anon・authenticated から呼べた。
--
-- service_role (サーバ側の処理・cron) は RLS を通らないので、1〜3 の影響を受けない。
-- 冪等: drop … if exists / create or replace で、何度当てても同じになる。

-- ── 1. 関連する列の組み合わせ ──────────────────────────────────────────────
-- (表, ポリシー名, コマンド, 担当の判定 (USING), WITH CHECK)
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- 発報: カメラは発報の店舗のもの
      ('alarm_events', 'alarm_events_admin_insert', 'insert', null,
       'public.can_manage_store(store_id) and (camera_id is null or public.store_of_camera(camera_id) = store_id)'),
      ('alarm_events', 'alarm_events_admin_update', 'update', 'public.can_manage_store(store_id)',
       'public.can_manage_store(store_id) and (camera_id is null or public.store_of_camera(camera_id) = store_id)'),
      -- 発報のコマ: カメラは親の発報の店舗のもの
      ('alarm_frames', 'alarm_frames_admin_insert', 'insert', null,
       'public.can_manage_store(public.store_of_alarm_event(alarm_event_id)) and (camera_id is null or public.store_of_camera(camera_id) = public.store_of_alarm_event(alarm_event_id))'),
      ('alarm_frames', 'alarm_frames_admin_update', 'update', 'public.can_manage_store(public.store_of_alarm_event(alarm_event_id))',
       'public.can_manage_store(public.store_of_alarm_event(alarm_event_id)) and (camera_id is null or public.store_of_camera(camera_id) = public.store_of_alarm_event(alarm_event_id))'),
      -- BCP のクリップ: カメラは親の BCP の店舗のもの (利用者・エッジとも)
      ('bcp_clips', 'bcp_clips_admin_insert', 'insert', null,
       'public.can_manage_store(public.store_of_bcp_event(event_id)) and (camera_id is null or public.store_of_camera(camera_id) = public.store_of_bcp_event(event_id))'),
      ('bcp_clips', 'bcp_clips_admin_update', 'update', 'public.can_manage_store(public.store_of_bcp_event(event_id))',
       'public.can_manage_store(public.store_of_bcp_event(event_id)) and (camera_id is null or public.store_of_camera(camera_id) = public.store_of_bcp_event(event_id))'),
      ('bcp_clips', 'bcp_clips_edge_insert', 'insert', null,
       'public.edge_owns_bcp_event(event_id) and (camera_id is null or public.store_of_camera(camera_id) = public.store_of_bcp_event(event_id))'),
      -- BCP のグリッド: 録画機は親の BCP の店舗のもの
      ('bcp_grid_shots', 'bcp_grid_shots_admin_insert', 'insert', null,
       'public.can_manage_store(public.store_of_bcp_event(event_id)) and (recorder_id is null or public.store_of_recorder(recorder_id) = public.store_of_bcp_event(event_id))'),
      ('bcp_grid_shots', 'bcp_grid_shots_admin_update', 'update', 'public.can_manage_store(public.store_of_bcp_event(event_id))',
       'public.can_manage_store(public.store_of_bcp_event(event_id)) and (recorder_id is null or public.store_of_recorder(recorder_id) = public.store_of_bcp_event(event_id))'),
      -- 巡回の所見: カメラは親の巡回の店舗のもの
      ('patrol_findings', 'patrol_findings_admin_insert', 'insert', null,
       'public.can_manage_store(public.store_of_patrol_run(run_id)) and (camera_id is null or public.store_of_camera(camera_id) = public.store_of_patrol_run(run_id))'),
      ('patrol_findings', 'patrol_findings_admin_update', 'update', 'public.can_manage_store(public.store_of_patrol_run(run_id))',
       'public.can_manage_store(public.store_of_patrol_run(run_id)) and (camera_id is null or public.store_of_camera(camera_id) = public.store_of_patrol_run(run_id))'),
      -- 検査のクリップ (エッジ): カメラと検査の記録はエッジの店舗のもの
      ('inspection_clips', 'inspection_clips_edge_insert', 'insert', null,
       'store_id = public.jwt_edge_store_id() and tenant_id = public.jwt_edge_tenant_id() and public.edge_owns_inspection_session(session_id) and (camera_id is null or public.store_of_camera(camera_id) = store_id)'),
      ('inspection_clips', 'inspection_clips_edge_update', 'update', 'store_id = public.jwt_edge_store_id()',
       'store_id = public.jwt_edge_store_id() and tenant_id = public.jwt_edge_tenant_id() and public.edge_owns_inspection_session(session_id) and (camera_id is null or public.store_of_camera(camera_id) = store_id)'),
      ('inspection_clip_jobs', 'inspection_clip_jobs_edge_update', 'update', 'store_id = public.jwt_edge_store_id()',
       'store_id = public.jwt_edge_store_id() and public.edge_owns_inspection_session(session_id) and (camera_id is null or public.store_of_camera(camera_id) = store_id)')
    ) as t(tbl, pol, cmd, using_expr, check_expr)
  loop
    execute format('drop policy if exists %I on public.%I', r.pol, r.tbl);
    if r.cmd = 'insert' then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
        r.pol, r.tbl, r.check_expr);
    else
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
        r.pol, r.tbl, r.using_expr, r.check_expr);
    end if;
  end loop;
end $$;

-- ── 2. 役割だけ・テナントだけを見る書き込みのポリシーを外す ───────────────────
-- 計測は lib/metrics.ts がサーバの接続で書く。利用者の接続から作る経路は無い。
drop policy if exists metric_events_insert on public.metric_events;

-- ライセンスの台帳は /api/admin/licenses (登録・差し替え) と /api/admin/licenses/[id] (失効) が
-- サーバの接続で書く (エッジとテナントの組み合わせ・版の番号は API が決める)。
-- 読み取りは licenses_select (自テナント・運営は全部) のまま。
drop policy if exists licenses_modify on public.licenses;

-- ── 3. 店舗の行 ─────────────────────────────────────────────────────────────
-- 担当の範囲は stores_select・can_manage_store と同じ形: 運営=全店舗・テナントの管理者=自テナント・
-- 店長=担当の店舗 (store_ids)。閲覧の役割は書けない (これまでどおり)。
drop policy if exists stores_update on public.stores;
create policy stores_update on public.stores
  for update to authenticated
  using (
    public.auth_user_role() = 'super_admin'
    or (public.auth_user_role() = 'tenant_admin' and public.auth_user_tenant_id() = tenant_id)
    or (public.auth_user_role() = 'store_manager' and public.auth_user_tenant_id() = tenant_id
        and id = any (coalesce(public.auth_user_store_ids(), '{}'::uuid[])))
  )
  with check (
    public.auth_user_role() = 'super_admin'
    or (public.auth_user_role() = 'tenant_admin' and public.auth_user_tenant_id() = tenant_id)
    or (public.auth_user_role() = 'store_manager' and public.auth_user_tenant_id() = tenant_id
        and id = any (coalesce(public.auth_user_store_ids(), '{}'::uuid[])))
  );

-- 有料オプション (opt_patrol・opt_alarm・opt_baggage) と所属テナント (tenant_id) は、
-- API (/api/admin/stores・/api/admin/stores/[id]・/api/admin/import/stores) と同じ規則を DB でも守る:
--   - 運営 (super_admin) は変えられる
--   - テナントの管理者 (tenant_admin) は opt_* を変えられる。ただし OFF → ON はテナントが
--     その機能を契約している (tenants.opt_* が真) ときだけ (API の option_not_contracted と同じ)
--   - それ以外の役割 (店長ほか) は opt_* を変えられない (API は黙って捨てる・DB は断る)
--   - tenant_id は運営しか変えられない (店舗を別テナントへ移せない)
-- テナントの契約を読むため SECURITY DEFINER (tenants は利用者の接続から読めない)。
-- サーバの接続 (service_role) とエッジ・cron には効かない。
create or replace function public.stores_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role     text;
  v_contract jsonb;
  v_new      jsonb := to_jsonb(new);
  v_old      jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_col      text;
  v_next     boolean;
  v_prev     boolean;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;

  v_role := public.auth_user_role();
  if v_role = 'super_admin' then return new; end if;

  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'stores.tenant_id is managed by the operator only'
      using errcode = 'insufficient_privilege';
  end if;

  select to_jsonb(t) into v_contract
    from (select opt_patrol, opt_alarm, opt_baggage from public.tenants where id = new.tenant_id) t;

  foreach v_col in array array['opt_patrol', 'opt_alarm', 'opt_baggage'] loop
    v_next := coalesce((v_new ->> v_col)::boolean, false);
    v_prev := coalesce((v_old ->> v_col)::boolean, false);
    if v_next is distinct from v_prev then
      if v_role is distinct from 'tenant_admin' then
        raise exception 'stores.% may be changed by tenant_admin or super_admin only', v_col
          using errcode = 'insufficient_privilege';
      end if;
      if v_next and not coalesce((v_contract ->> v_col)::boolean, false) then
        raise exception 'option_not_contracted: %', v_col
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
comment on function public.stores_guard_privileged_columns() is
  '利用者の接続からの stores の opt_* と tenant_id の変更を API と同じ規則に絞る (運営・契約内のテナントの管理者だけ)。';
revoke all on function public.stores_guard_privileged_columns() from public, anon, authenticated;

drop trigger if exists trg_stores_privileged_columns on public.stores;
create trigger trg_stores_privileged_columns
  before insert or update on public.stores
  for each row execute function public.stores_guard_privileged_columns();

-- ── 4. 利用者のトークンで呼べる SECURITY DEFINER の関数 ─────────────────────────
-- 4a. start_live_session: 店舗が見えること (stores_select と同じ形) と、表に付けている
--     RESTRICTIVE の層 (first_party_only・mfa_aal2_only・tenant_active_only・user_active_only)
--     と同じ条件を関数の中で確かめる。SECURITY DEFINER の中は RLS を通らないため。
--     ほかは 20260810050000_start_live_session.sql のまま。
create or replace function public.start_live_session(
  p_store_id  uuid,
  p_mode      text,
  p_camera_id uuid        default null,
  p_vod_from  timestamptz default null,
  p_vod_to    timestamptz default null
)
returns table (
  session_id      uuid,
  active_count    int,
  limit_max       int,
  session_max_min int,
  rejected        boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
declare
  -- 上限の対象は帯域コストの高い live / vod のみ。grid（スナップ合成）は安価。
  c_limited     constant text[]   := array['live', 'vod'];
  c_default_max constant int      := 5;
  c_default_min constant int      := 120;
  -- これより古い未終了セッションは「閉じ忘れ(孤児)」とみなしカウント外。
  -- 入れておかないと、1 度の異常終了でそのテナントが恒久的にロックアウトされる。
  c_window      constant interval := '6 hours';

  v_user   uuid := auth.uid();
  v_role   text;
  v_tenant uuid;
  v_max    int;
  v_maxmin int;
  v_active int := 0;
  v_id     uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if p_mode is null or p_mode not in ('grid', 'live', 'vod') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;

  -- 表の RESTRICTIVE の層と同じ条件 (外部のクライアントのトークン・多要素認証の未完了・
  -- 止めたテナント・切ったセッションや止めた利用者は使えない)。
  if not coalesce(public.jwt_is_first_party()
                  and public.jwt_mfa_satisfied()
                  and not public.auth_tenant_suspended()
                  and not public.auth_user_blocked(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select s.tenant_id into v_tenant from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  -- 店舗が見えること (stores_select と同じ形: 運営=全店舗・テナントの管理者=自テナント・
  -- それ以外=担当の店舗)。API (/api/sessions) も先に同じことを RLS で確かめている。
  -- 管理者の行が無い利用者では役割が NULL になるので、coalesce で偽に倒す (NULL のまま
  -- if not (...) に渡すと条件が成り立たず、素通りしてしまう)。
  v_role := public.auth_user_role();
  if not coalesce(
       v_role = 'super_admin'
       or (v_role = 'tenant_admin' and public.auth_user_tenant_id() = v_tenant)
       or p_store_id = any (coalesce(public.auth_user_store_ids(), '{}'::uuid[])),
       false) then
    raise exception 'store_not_visible' using errcode = '42501';
  end if;

  select l.max_concurrent, l.max_session_min into v_max, v_maxmin
    from public.session_limits l
   where l.tenant_id = v_tenant;
  v_max    := coalesce(v_max, c_default_max);
  v_maxmin := coalesce(v_maxmin, c_default_min);

  if p_mode = any (c_limited) then
    -- テナント単位で直列化する。トランザクション終了で自動的に解放される。
    -- 店舗ではなくテナント単位なのは、上限がテナント単位で数えられるため。
    perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 0));

    select count(*) into v_active
      from public.live_sessions ls
      join public.stores s on s.id = ls.store_id
     where ls.ended_at is null
       and ls.started_at >= now() - c_window
       and ls.mode = any (c_limited)
       and s.tenant_id = v_tenant;

    if v_active >= v_max then
      return query select null::uuid, v_active, v_max, v_maxmin, true;
      return;
    end if;
  else
    -- grid は上限対象外。呼び出し側の契約に合わせて最大分数も返さない。
    v_maxmin := null;
  end if;

  insert into public.live_sessions
    (user_id, store_id, camera_id, mode, started_at, vod_from, vod_to)
  values
    (v_user, p_store_id, p_camera_id, p_mode, now(), p_vod_from, p_vod_to)
  returning live_sessions.id into v_id;

  return query select v_id, v_active, v_max, v_maxmin, false;
end;
$$;
comment on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) is
  '視聴セッションの開始。店舗が見えること・RESTRICTIVE の層と同じ条件を関数の中で確かめ、'
  '同時視聴上限の判定と INSERT を 1 トランザクションで行う。';
revoke all on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) to authenticated, service_role;

-- 4b. cron とサーバ (service_role) だけが使う関数を、anon・authenticated から呼べなくする。
--     cron は postgres (関数の所有者) で動くので影響しない。
--       bcp_sweep_pending_reports / invoke_bcp_report … BCP の報告の起動 (cron bcp_report_sweep)
--       invoke_jalert_poller                          … J-Alert の取得の起動 (cron jalert_poll)
--       usage_summary / usage_trend / usage_weekday   … 利用の集計 (画面と月次の報告がサーバの接続で呼ぶ)
--       detect_unmatched_entries                      … 受付 (旧) の未退出の検出 (呼び出し元なし)
--     どれも引数のテナント・店舗・イベントを呼び出し元の権限で確かめない。
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.bcp_sweep_pending_reports()',
    'public.invoke_bcp_report(uuid)',
    'public.invoke_jalert_poller()',
    'public.detect_unmatched_entries(date)',
    'public.usage_summary(date, date, uuid, uuid[])',
    'public.usage_trend(date, date, uuid, uuid[])',
    'public.usage_weekday(date, date, uuid, uuid[])'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
