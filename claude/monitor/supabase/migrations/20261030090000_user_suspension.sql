-- 利用者を 1 人だけ止める・特定の利用者のセッションを切る (2026-10-30・自主診断 ASVS 7.4.2・7.4.5)。
--
-- それまでは、1 人を止めるには利用者を消すしかなかった。管理の画面 (利用者の編集) から:
--   - 利用を止める: Supabase Auth の ban (新しいログインとトークンの更新を断る) + セッションを全部消す
--   - 利用を戻す:   ban を外す
--   - セッションを切る: セッションを全部消す (利用者はもう一度ログインする)
-- ban は GoTrue の管理 API で行う (アプリ・src/app/api/admin/users/[id]/access/route.ts)。ここでは DB の側:
--   1. revoke_user_sessions(): auth.sessions を消す (リフレッシュトークンは外部キーの cascade で消える)。
--      GoTrue の管理 API には「利用者を指定して全部のセッションを切る」が無いため、DB で行う
--   2. user_suspension_states(): 管理の画面が停止中かとセッションの数を出すため
--   3. auth_user_blocked() と RESTRICTIVE の user_active_only: 切ったセッションのアクセストークン
--      (有効期限の jwt_expiry まで署名としては正しい) と、止めた利用者のトークンで DB を使わせない。
--      画面と API は getUser (GoTrue がセッションの有無を確かめる) で止まるが、PostgREST へ
--      直接来たトークンは署名しか見ないため、ここで止める
-- service_role・セッションを持たないトークン (エッジの device token) には影響しない。

-- 1. 利用者のセッションを全部消す (service_role だけ)
create or replace function public.revoke_user_sessions(p_user uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.revoke_user_sessions(uuid) is
  '利用者のセッションを全部消す (管理の画面の「セッションを切る」「利用を止める」)。消した数を返す。';
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- 2. 停止中か (ban の期限) と、有効なセッションの数 (service_role だけ)
create or replace function public.user_suspension_states(p_users uuid[])
returns table (user_id uuid, banned_until timestamptz, sessions integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id,
         u.banned_until,
         (select count(*)::int from auth.sessions s
           where s.user_id = u.id and (s.not_after is null or s.not_after > now()))
    from auth.users u
   where u.id = any(p_users)
$$;
comment on function public.user_suspension_states(uuid[]) is
  '利用者ごとの停止 (banned_until) と有効なセッションの数。管理の画面が使う。';
revoke all on function public.user_suspension_states(uuid[]) from public, anon, authenticated;
grant execute on function public.user_suspension_states(uuid[]) to service_role;

-- 3. 今のトークンが「切ったセッション」か「止めた利用者」のものか
create or replace function public.auth_user_blocked()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  sid text := auth.jwt() ->> 'session_id';
  uid uuid := auth.uid();
begin
  -- セッションを持つトークン (Supabase Auth のログイン) は、そのセッションが残っていること
  if sid is not null then
    if sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return true;
    end if;
    if not exists (select 1 from auth.sessions s where s.id = sid::uuid) then
      return true;
    end if;
  end if;
  -- 止めた利用者 (ban の期限が先にある)
  if uid is not null and exists (
       select 1 from auth.users u where u.id = uid and u.banned_until is not null and u.banned_until > now()) then
    return true;
  end if;
  return false;
end;
$$;
comment on function public.auth_user_blocked() is
  '今のトークンのセッションが切られているか、利用者が止められているか (ポリシー user_active_only が使う)。';
revoke all on function public.auth_user_blocked() from public, anon;
grant execute on function public.auth_user_blocked() to authenticated;

-- 許すポリシーを持つ全部の表に RESTRICTIVE の user_active_only を付ける
-- (20261029170000_tenant_suspension.sql の tenant_active_only と同じ選び方)
do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity and not c.relispartition
       and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polpermissive)
  loop
    execute format('drop policy if exists user_active_only on public.%I', t);
    execute format(
      'create policy user_active_only on public.%I as restrictive for all to authenticated '
      'using (not (select public.auth_user_blocked())) with check (not (select public.auth_user_blocked()))', t);
  end loop;
end $$;
