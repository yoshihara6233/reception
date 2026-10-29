-- 拠点 (G・VMS) 向けに出したトークンを、クラウドの DB で使えないようにする
-- (2026-10-28 自主診断 ASVS 9.2.3・10.3.1・10.1.1)。
--
-- ログインの一本化 (GVMS_CLOUD_SPEC §9) で、拠点は OAuth の公開クライアントとして
-- クラウドの利用者のトークンを受け取る。拠点が知りたいのは「誰か」と「拠点での役割」
-- (gvms_role) だけだが、トークンの aud はクラウドの画面のログインと同じ authenticated で、
-- RLS も client_id を見ていなかった。つまり**拠点に渡ったトークンで、その利用者の権限のまま
-- クラウドの DB (PostgREST) を読み書きできた**。拠点の機械や管理者が信頼できない現場では、
-- 1 拠点からクラウドの利用者になりすませる。
--
-- 直し方: public の RLS を有効にした表のうち、許すポリシーを持つ全部の表に、RESTRICTIVE のポリシーを 1 本ずつ足す。
--   「トークンに client_id が無い (= クラウド自身のログインかエッジのトークン)」ときだけ通す。
--   RESTRICTIVE は他のポリシーと AND で効くので、今ある許可の範囲は変わらない。
--   service_role は RLS を通らないので、サーバ側の処理には影響しない。
-- 画面の入口 (middleware) でも同じトークンを断る (src/lib/auth/foreign-client.ts)。

create or replace function public.jwt_is_first_party()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'client_id', '') = ''
$$;
comment on function public.jwt_is_first_party() is
  'トークンが OAuth のクライアント (G・VMS の拠点) 向けでないか。拠点向けのトークンでは DB を使わせない。';
grant execute on function public.jwt_is_first_party() to authenticated, anon;

do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity and not c.relispartition
       -- 許すポリシーが 1 本も無い表 (service_role 専用・台帳 NO_POLICY_OK) は、もともと何も通さない
       and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polpermissive
                    and p.polname <> 'first_party_only')
  loop
    execute format('drop policy if exists first_party_only on public.%I', t);
    execute format(
      'create policy first_party_only on public.%I as restrictive for all to authenticated '
      'using (public.jwt_is_first_party()) with check (public.jwt_is_first_party())', t);
  end loop;
end $$;

-- 拠点のクライアントから refresh_token の権限を外した印 (10.1.1)。
-- 拠点 (G・VMS) は認可コードで 1 度だけ身元を受け取り、自分のセッションを作る。refresh トークンは
-- 使わないのに、期限の無い refresh トークンを受け取っていた。新しいクライアントは最初から
-- authorization_code だけで作り、既にあるクライアントは次の heartbeat で直して印を立てる
-- (Auth の管理 API は migration から呼べないため・src/lib/edge/gvms-oidc.ts)。
alter table public.gvms_oidc_clients
  add column if not exists code_grant_only boolean not null default false;
comment on column public.gvms_oidc_clients.code_grant_only is
  'grant_types を authorization_code だけにしたか (2026-10-29 より前に作ったクライアントは false)。';
