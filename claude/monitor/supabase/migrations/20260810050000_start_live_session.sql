-- 同時視聴上限（F-10）を 1 トランザクションで決める。
--
-- ── なぜ必要か ────────────────────────────────────────────────────────────
-- 旧実装は /api/sessions のハンドラで「数える → 入れる」を 2 回の往復に
-- 分けていた。そこに 2 つの欠陥があった。
--
--  ① 数える側が常に失敗していた。件数は PostgREST の埋め込み
--     `live_sessions.select('id, stores!inner(tenant_id)')` で取っていたが、
--     **live_sessions → stores の外部キーが存在しない**（月次パーティション
--     化した時点で失われ、remote_baseline にも無い）。埋め込みは解決できず
--     PostgREST は 400 を返す。ハンドラは `const { count } = ...` と
--     error を捨てていたので count は null、`count ?? 0` で 0 になり、
--     **`0 >= max` は常に偽＝上限は一度も発動していなかった**。
--     429 も metric(session_rejected) も出ないので、画面上は「上限に
--     達していない」ようにしか見えない。
--
--  ② 数えてから入れるまでに隙がある。①を直しても、同時に来た N 本は
--     全員が同じ件数を見て全員が通る（TOCTOU）。
--
-- ── 直し方 ────────────────────────────────────────────────────────────────
-- 判定と INSERT を 1 つの関数＝1 トランザクションに畳み、テナント単位の
-- advisory lock で直列化する。件数は**素の SQL の JOIN** で取るので、
-- 外部キーの有無にもスキーマキャッシュにも依存しない。
--
-- 本日入れた rate_limit_hit と同じ方針（判定は DB の 1 単位に任せる）。
--
-- ⚠ user_id は引数で受け取らない。**auth.uid() を関数の中で読む。**
--   security definer なので、引数にすると他人のセッションを作れてしまう。

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

  select s.tenant_id into v_tenant from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0002';
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
  '視聴セッションの開始。同時視聴上限の判定と INSERT を 1 トランザクションで行う。'
  '店舗の可視性(RLS)は呼び出し側で先に確認すること。';

-- 呼ぶのはログイン済みユーザ本人（auth.uid() を関数内で読む）。
-- Supabase 固有のロールは素の Postgres（authz テスト用DB）に無いので、
-- 存在するときだけ触る＝どちらの環境でも同じ SQL が通る。
revoke all on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.start_live_session(uuid, text, uuid, timestamptz, timestamptz) to service_role';
  end if;
end $$;
