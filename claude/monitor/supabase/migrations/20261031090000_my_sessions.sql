-- 利用者が自分のサインイン中の端末を見て、1 つずつ・今の端末以外をまとめて切る (2026-10-31・自主診断 ASVS 7.5.2)。
--
-- それまでは、セッションを切れるのは管理者だけ (20261030090000_user_suspension.sql の revoke_user_sessions・
-- 利用者を指定して全部) で、本人は自分がどの端末でサインインしたままかを見られなかった。端末を
-- 無くした・共用の端末で切り忘れたときに、本人がその端末だけを切れるようにする。
--
-- どれも本人のセッションだけを扱う (auth.uid() で絞る)。auth.sessions は利用者から読めないので
-- security definer で読む。今の端末は、アクセストークンの session_id で見分ける。
-- 行を消すと、そのセッションのリフレッシュトークンは外部キーの cascade で消え、アクセストークンは
-- auth_user_blocked() (RESTRICTIVE の user_active_only) で DB に入れなくなる。
--
-- 冪等: create or replace のみ。

-- 1. 自分のセッションの一覧 (新しい順)
create or replace function public.my_sessions()
returns table (
  id          uuid,
  created_at  timestamptz,
  last_seen   timestamptz,
  user_agent  text,
  ip          text,
  aal         text,
  current     boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id,
         s.created_at,
         coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) as last_seen,
         s.user_agent,
         host(s.ip) as ip,
         s.aal::text,
         s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid as current
    from auth.sessions s
   where s.user_id = auth.uid()
   order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc
   limit 100
$$;
comment on function public.my_sessions() is
  '自分のサインイン中の端末の一覧 (アカウント › サインイン中の端末)。今の端末は current=true。';
revoke all on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;

-- 2. 自分のセッションを 1 つ切る。今の端末は切らない (それはサインアウトで行う)。消した数 (0 か 1) を返す
create or replace function public.revoke_my_session(p_session uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  delete from auth.sessions
   where id = p_session
     and user_id = auth.uid()
     and id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid;
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.revoke_my_session(uuid) is
  '自分のセッションを 1 つ切る (今の端末は除く)。消した数を返す。';
revoke all on function public.revoke_my_session(uuid) from public, anon;
grant execute on function public.revoke_my_session(uuid) to authenticated;

-- 3. 今の端末以外の自分のセッションを全部切る。消した数を返す
create or replace function public.revoke_my_other_sessions()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
  cur uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null or cur is null then
    return 0;  -- 今の端末がわからないときは、今の端末まで消さないよう何もしない
  end if;
  delete from auth.sessions where user_id = auth.uid() and id <> cur;
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.revoke_my_other_sessions() is
  '今の端末以外の自分のセッションを全部切る。消した数を返す。';
revoke all on function public.revoke_my_other_sessions() from public, anon;
grant execute on function public.revoke_my_other_sessions() to authenticated;
