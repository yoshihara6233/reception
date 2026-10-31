-- 同時視聴の上限をサーバで確かめる (2026-10-31・発注者の判断 A)。
--
-- それまでの穴:
--   1. 上限を見るのは start_live_session (/api/sessions) だけで、遠隔視聴の開始
--      (POST /api/video/sessions) は見ていなかった。受け口を直接呼ぶと上限を超えられた。
--      G・VMS の録画の遠隔再生は、画面からも数えていなかった。
--   2. 終了の知らせが届かなかった行を 6 時間数え続け、6 時間を超えて見ている人は数えなかった
--      (連続視聴の時間の上限は 10/31 に廃止したので、長く見る人が増える)。
--
-- 直し:
--   - live_sessions に last_seen_at (画面が 1 分ごとに更新)。5 分途切れたら数えない。
--     この列が無い行 (直しの前に始めた画面) は、これまでどおり開始から 6 時間まで数える。
--   - 数え方を tenant_active_viewings() の 1 か所にする。開いている視聴の行に、対応する行の
--     ない遠隔視聴 (生存の合図 viewer_seen_at が 1 分以内) を足す。ライブの画面は視聴の行と
--     遠隔視聴の両方を作るので、同じ人・同じカメラは 2 つに数えない。
--   - open_video_session(): 遠隔視聴の開始で、確かめと作成を 1 トランザクションで行う。
--     同じ人・同じカメラの視聴の行があれば、もう数えてあるので断らない (ライブの画面は
--     2 つの開始を順序の保証なしに呼ぶので、どちらが先でも同じ結果になるようにする)。
--
-- 冪等: add column if not exists・create or replace のみ。

alter table public.live_sessions add column if not exists last_seen_at timestamptz;
comment on column public.live_sessions.last_seen_at is
  '画面の生存の合図 (1 分ごとに更新)。5 分途切れたら同時視聴に数えない。NULL は直しの前に始めた画面。';

-- 1. 視聴の行がいま生きているか (数える条件を 1 か所に)
create or replace function public.live_session_is_fresh(p_last_seen timestamptz, p_started timestamptz)
returns boolean
language sql
stable
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
  select case when p_last_seen is not null then p_last_seen >= now() - interval '5 minutes'
              else p_started >= now() - interval '6 hours' end
$$;

-- 2. テナントの同時視聴の数。p_user・p_camera を渡すと、その人のそのカメラの遠隔視聴は数えない
--    (これから開く分。開き直しで前のセッションを止める分や、先に開いた同じ画面の分)
create or replace function public.tenant_active_viewings(
  p_tenant uuid,
  p_user   uuid default null,
  p_camera uuid default null
)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
  select (
    select count(*)::int
      from public.live_sessions ls
      join public.stores s on s.id = ls.store_id
     where s.tenant_id = p_tenant
       and ls.ended_at is null
       and ls.mode in ('live', 'vod')
       and public.live_session_is_fresh(ls.last_seen_at, ls.started_at)
  ) + (
    select count(*)::int
      from public.video_sessions v
      join public.stores s on s.id = v.store_id
     where s.tenant_id = p_tenant
       and v.state in ('requested', 'dispatched', 'started')
       and v.stop_requested_at is null
       and v.viewer_seen_at >= now() - interval '1 minute'
       and not (v.user_id is not distinct from p_user and v.camera_id is not distinct from p_camera)
       and not exists (
         select 1 from public.live_sessions ls
          where ls.user_id = v.user_id
            and ls.camera_id = v.camera_id
            and ls.ended_at is null
            and ls.mode in ('live', 'vod')
            and public.live_session_is_fresh(ls.last_seen_at, ls.started_at)
       )
  )
$$;
comment on function public.tenant_active_viewings(uuid, uuid, uuid) is
  'テナントの同時視聴の数 (視聴の行 + 対応する行のない遠隔視聴)。上限の判定だけに使う。';
revoke all on function public.tenant_active_viewings(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.tenant_active_viewings(uuid, uuid, uuid) to service_role;

-- 3. start_live_session: 数え方を上の関数に替え、新しい行に last_seen_at を入れる。ほかは
--    20261030120000_authz_data_scope.sql のまま (連続視聴の分数の列は返すが、画面は使わない)
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

  -- 店舗が見えること (stores_select と同じ形)。
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
    perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 0));

    -- 同じ人・同じカメラの遠隔視聴は、この行で数えるので除く (先に開いていても断らない)
    v_active := public.tenant_active_viewings(v_tenant, v_user, p_camera_id);

    if v_active >= v_max then
      return query select null::uuid, v_active, v_max, v_maxmin, true;
      return;
    end if;
  else
    -- grid は上限対象外。
    v_maxmin := null;
  end if;

  insert into public.live_sessions
    (user_id, store_id, camera_id, mode, started_at, vod_from, vod_to, last_seen_at)
  values
    (v_user, p_store_id, p_camera_id, p_mode, now(), p_vod_from, p_vod_to, now())
  returning live_sessions.id into v_id;

  return query select v_id, v_active, v_max, v_maxmin, false;
end;
$$;
comment on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) is
  '視聴セッションの開始。店舗が見えること・RESTRICTIVE の層と同じ条件を関数の中で確かめ、'
  '同時視聴上限の判定と INSERT を 1 トランザクションで行う。';
revoke all on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) to authenticated, service_role;

-- 4. 遠隔視聴の開始 (service_role だけ。認可は /api/video/sessions が RLS 配下で済ませてから呼ぶ)。
--    同じ人が同じカメラで開いていた前のセッションを止め、上限を確かめ、行を作るまでを 1 トランザクションで行う
create or replace function public.open_video_session(
  p_user        uuid,
  p_store_id    uuid,
  p_edge_id     uuid,
  p_camera_id   uuid,
  p_viewer_name text,
  p_kind        text,
  p_stream      text,
  p_vod_from    timestamptz default null,
  p_vod_to      timestamptz default null
)
returns table (
  session_id   uuid,
  active_count int,
  limit_max    int,
  rejected     boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
declare
  c_default_max constant int := 5;
  v_tenant  uuid;
  v_max     int;
  v_active  int := 0;
  v_counted boolean;
  v_id      uuid;
begin
  select s.tenant_id into v_tenant from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  select l.max_concurrent into v_max from public.session_limits l where l.tenant_id = v_tenant;
  v_max := coalesce(v_max, c_default_max);

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 0));

  -- 同じ人・同じカメラの視聴の行があれば、もう数えてある (ライブの画面)
  select exists (
    select 1 from public.live_sessions ls
     where ls.user_id = p_user
       and ls.camera_id = p_camera_id
       and ls.ended_at is null
       and ls.mode in ('live', 'vod')
       and public.live_session_is_fresh(ls.last_seen_at, ls.started_at)
  ) into v_counted;

  v_active := public.tenant_active_viewings(v_tenant, p_user, p_camera_id);
  if not v_counted and v_active >= v_max then
    return query select null::uuid, v_active, v_max, true;
    return;
  end if;

  -- 同じ人が同じカメラで開いていた前のセッションは止める (再読み込み・画面の開き直し)
  update public.video_sessions v
     set stop_requested_at = now()
   where v.user_id = p_user
     and v.camera_id = p_camera_id
     and v.state in ('requested', 'dispatched', 'started')
     and v.stop_requested_at is null;

  insert into public.video_sessions
    (edge_id, camera_id, store_id, user_id, viewer_name, kind, stream, vod_from, vod_to)
  values
    (p_edge_id, p_camera_id, p_store_id, p_user, p_viewer_name, p_kind, p_stream, p_vod_from, p_vod_to)
  returning video_sessions.id into v_id;

  return query select v_id, v_active, v_max, false;
end;
$$;
comment on function public.open_video_session(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz) is
  '遠隔視聴の開始。前のセッションを止め、同時視聴の上限を確かめ、行を作るまでを 1 トランザクションで行う。';
revoke all on function public.open_video_session(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.open_video_session(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz) to service_role;
