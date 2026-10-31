-- 管理者の多要素認証を必須にする (2026-10-31・発注者の判断・自主診断 ASVS 6.3.3)。
--
-- super_admin と tenant_admin は、多要素を登録して aal2 になるまで表を使えない。
-- 画面と受け口は middleware が登録の画面へ送るが、それは Next を通る経路だけなので、
-- DB の層 (mfa_aal2_only・RESTRICTIVE) でも同じ条件にする。
-- それ以外の役割はこれまでどおり任意 (登録した人だけ aal2 を求める)。
--
-- 当てる順番: アプリを先に本番へ入れ、管理者全員が登録したことを確かめてから当てる
-- (登録の画面と受け口は表を読まないので、当てたあとでも未登録の人は登録できる)。
-- 冪等: create or replace のみ。

create or replace function public.jwt_mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or auth.uid() is null
      or (
        not exists (
          select 1 from auth.mfa_factors f
           where f.user_id = auth.uid() and f.status = 'verified'
        )
        and coalesce(public.auth_user_role(), '') not in ('super_admin', 'tenant_admin')
      )
$$;
comment on function public.jwt_mfa_satisfied() is
  '多要素を登録した利用者と管理者 (super_admin・tenant_admin) なら aal2 のトークンか。それ以外で未登録なら真。';
