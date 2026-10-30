-- 拠点 (G・VMS) へのサインインの許可の期限を「最後に使ってから 90 日」にするための記録
-- (2026-10-30・発注者の決定 案 B・自主診断 ASVS 10.4.9・GVMS_CLOUD_SPEC §9.5)。
--
-- ── 何を変えるか ────────────────────────────────────────────────────────
-- #428 では、許可 (OAuth の同意・grant) の期限を「承認から 90 日」にした。毎日使っている人も
-- 90 日ごとに同意の画面が出る。発注者の決定で「使っている間は切れず、最後に使ってから 90 日
-- 使わなかった許可だけが切れる」にする。期限の計算はアプリ (lib/edge/gvms-grants.ts) が
-- max(承認の時刻, 最後に使った時刻) + 90 日 で行う。ここでは「最後に使った時刻」を残す。
--
-- ── 「使った」の印 ──────────────────────────────────────────────────────
-- 拠点で SSO のサインインをするたびに、その拠点向けのセッション (auth.sessions の oauth_client_id
-- が入っているもの) ができる。これを利用者 × クライアントごとの最後の時刻として
-- oauth_client_last_used に写す。セッションは purge_oauth_client_sessions() が作ってから 24 時間で
-- 消すので、**消す前に写す** (消してから写すと、使った記録が消える)。写すのは同じ 15 分ごとの
-- pg_cron (oauth_client_session_purge) の中で、purge が消す前に行う。
--   1. 表 oauth_client_last_used: service_role だけが書く。本人は自分の行を読める
--      (RESTRICTIVE の 4 層 first_party_only・mfa_aal2_only・tenant_active_only・user_active_only を合わせる)
--   2. record_oauth_client_use(): セッションから写す。許可の無くなった組の行は消す (service_role だけ)
--   3. purge_oauth_client_sessions(): 消す前に 2 を呼ぶ。2 が失敗しても消す処理は止めない
--      (24 時間の期限のほうが大事。写せなかった分は期限が早まる側に倒れる)
--   4. 当てた時点で 1 度写す (今あるセッションの分)
-- 既存の許可は、最初は最後に使った時刻が無いので承認の時刻から数える (アプリの計算)。
-- 冪等: create table if not exists・create or replace・drop policy if exists。

-- ── 1. 表 ────────────────────────────────────────────────────────────────
create table if not exists public.oauth_client_last_used (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  -- auth.oauth_clients.id。auth のスキーマは Supabase が持つので外部キーは張らず、
  -- 許可の無くなった組は record_oauth_client_use() が消す
  client_id    uuid        not null,
  last_used_at timestamptz not null,
  primary key (user_id, client_id)
);
comment on table public.oauth_client_last_used is
  '拠点 (OAuth のクライアント) へのサインインの許可を最後に使った時刻。許可の期限 = max(承認, 最後に使った) + 90 日 (lib/edge/gvms-grants.ts)。書くのは record_oauth_client_use() (service_role) だけ。';
comment on column public.oauth_client_last_used.last_used_at is
  'その拠点向けのセッション (auth.sessions) を最後に作った・更新した時刻。';

alter table public.oauth_client_last_used enable row level security;

revoke all on table public.oauth_client_last_used from public, anon, authenticated;
grant select on table public.oauth_client_last_used to authenticated;

-- 本人は自分の行だけを読める (アカウントの画面・同意の画面が本人の接続で読む)
drop policy if exists oauth_client_last_used_select_own on public.oauth_client_last_used;
create policy oauth_client_last_used_select_own on public.oauth_client_last_used
  for select to authenticated
  using (user_id = (select auth.uid()));

-- RESTRICTIVE の層 (20261029090000・20261029120000・20261029170000・20261030090000 と同じ式)
drop policy if exists first_party_only on public.oauth_client_last_used;
create policy first_party_only on public.oauth_client_last_used as restrictive for all to authenticated
  using (public.jwt_is_first_party()) with check (public.jwt_is_first_party());
drop policy if exists mfa_aal2_only on public.oauth_client_last_used;
create policy mfa_aal2_only on public.oauth_client_last_used as restrictive for all to authenticated
  using ((select public.jwt_mfa_satisfied())) with check ((select public.jwt_mfa_satisfied()));
drop policy if exists tenant_active_only on public.oauth_client_last_used;
create policy tenant_active_only on public.oauth_client_last_used as restrictive for all to authenticated
  using (not (select public.auth_tenant_suspended())) with check (not (select public.auth_tenant_suspended()));
drop policy if exists user_active_only on public.oauth_client_last_used;
create policy user_active_only on public.oauth_client_last_used as restrictive for all to authenticated
  using (not (select public.auth_user_blocked())) with check (not (select public.auth_user_blocked()));

-- ── 2. セッションから写す ─────────────────────────────────────────────────
create or replace function public.record_oauth_client_use()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  -- 拠点向けのセッションの作った・更新した時刻のうち新しいほう (未来の時刻は今に丸める)
  insert into public.oauth_client_last_used as t (user_id, client_id, last_used_at)
  select s.user_id, s.oauth_client_id,
         least(max(greatest(s.created_at, coalesce(s.updated_at, s.created_at))), now())
    from auth.sessions s
   where s.oauth_client_id is not null
     and s.user_id is not null
     and s.created_at is not null
   group by s.user_id, s.oauth_client_id
  on conflict (user_id, client_id) do update
     set last_used_at = excluded.last_used_at
   where excluded.last_used_at > t.last_used_at;
  get diagnostics n = row_count;

  -- 許可の無くなった組 (取り消した・期限で切れた・クライアントを消した) の行は残さない。
  -- auth.oauth_consents を読めないときも、写した分は残す
  begin
    delete from public.oauth_client_last_used t
     where not exists (
       select 1 from auth.oauth_consents c
        where c.user_id = t.user_id and c.client_id = t.client_id and c.revoked_at is null);
  exception when others then
    raise warning 'record_oauth_client_use: 許可の無くなった行を消せませんでした (%)', sqlerrm;
  end;
  return n;
end;
$$;
comment on function public.record_oauth_client_use() is
  '拠点向けのセッション (auth.sessions.oauth_client_id) から、利用者 × クライアントの最後に使った時刻を oauth_client_last_used に写す。写した数を返す。許可の無くなった組の行は消す。';
revoke all on function public.record_oauth_client_use() from public, anon, authenticated;
grant execute on function public.record_oauth_client_use() to service_role;

-- ── 3. 消す前に写す (20261030093100 の関数に足す・引数と既定は同じ) ─────────
create or replace function public.purge_oauth_client_sessions(p_max_age interval default interval '24 hours')
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  -- 24 時間より長くは許さない (呼び出しの誤りで期限を延ばせないように)
  if p_max_age is null or p_max_age > interval '24 hours' or p_max_age < interval '0' then
    p_max_age := interval '24 hours';
  end if;
  -- 消す前に「最後に使った時刻」を写す。写せなくても消す処理は続ける
  begin
    perform public.record_oauth_client_use();
  exception when others then
    raise warning 'purge_oauth_client_sessions: 最後に使った時刻を写せませんでした (%)', sqlerrm;
  end;
  delete from auth.sessions
   where oauth_client_id is not null
     and created_at < now() - p_max_age;
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.purge_oauth_client_sessions(interval) is
  'OAuth のクライアント (G・VMS の拠点) 向けのセッションを、作ってから 24 時間 (既定・上限) で消す。消す前に最後に使った時刻を oauth_client_last_used に写す。消した数を返す (ASVS 10.4.8・10.4.9)。';
revoke all on function public.purge_oauth_client_sessions(interval) from public, anon, authenticated;
grant execute on function public.purge_oauth_client_sessions(interval) to service_role;

-- cron (oauth_client_session_purge・15 分ごと) は 20261030093100 のまま。同じ関数を呼ぶので登録は変えない。

-- ── 4. 今あるセッションの分を写す ─────────────────────────────────────────
select public.record_oauth_client_use();
