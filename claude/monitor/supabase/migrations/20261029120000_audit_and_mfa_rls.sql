-- 監査の記録と多要素の確認を DB でも守る (2026-10-29・自主診断 ASVS 16.4.2・6.3.4)。
--
-- 1. admin_audit_log の INSERT のポリシーを外す。
--    以前は「操作者 = 自分」なら管理の利用者は誰でも INSERT でき、PostgREST を直接呼ぶと、していない
--    操作の行を作れた。監査の行はサーバ (サービスの接続・src/lib/admin/audit.ts) だけが書く。
--
-- 2. 多要素を登録した利用者は、番号を確かめたトークン (aal2) でなければ DB を使えない。
--    画面と API は middleware が aal1 を止めているが、PostgREST の直接の呼び出しと middleware の
--    許可パス (/api/baggage など) は通っていた。パスワードだけを盗まれると、番号なしで読み書きできた。
--    RESTRICTIVE なので、今ある許可の範囲は変わらない。多要素を登録していない利用者・エッジの
--    トークン・service_role には影響しない。

drop policy if exists admin_audit_log_insert on public.admin_audit_log;

create or replace function public.jwt_mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or auth.uid() is null
      or not exists (
        select 1 from auth.mfa_factors f
         where f.user_id = auth.uid() and f.status = 'verified'
      )
$$;
comment on function public.jwt_mfa_satisfied() is
  '多要素を登録した利用者なら aal2 のトークンか。登録していなければ真。';
revoke all on function public.jwt_mfa_satisfied() from public;
grant execute on function public.jwt_mfa_satisfied() to authenticated;

do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity and not c.relispartition
       and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polpermissive)
  loop
    execute format('drop policy if exists mfa_aal2_only on public.%I', t);
    execute format(
      'create policy mfa_aal2_only on public.%I as restrictive for all to authenticated '
      'using ((select public.jwt_mfa_satisfied())) with check ((select public.jwt_mfa_satisfied()))', t);
  end loop;
end $$;
