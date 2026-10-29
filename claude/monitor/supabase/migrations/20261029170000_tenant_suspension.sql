-- テナントを停止 (suspended) したら、ログイン・拠点への SSO・拠点からの受信を止める
-- (2026-10-29・自主診断 ASVS 7.4.2)。
--
-- 取扱説明書 (第 2 部 9 章) は「停止すると拠点からの受信とログインが止まる」と書いていたが、
-- 実際には tenants.status を誰も見ておらず、停止しても利用者は入れ、拠点の SSO の
-- トークンも出て、エッジの送信も受けていた。ここでは DB の側を止める:
--   1. 停止したテナントの利用者・エッジのトークンは DB を使えない (RESTRICTIVE の tenant_active_only)
--   2. 拠点の SSO のトークンに gvms_role を載せない (拠点は 403 で断る)
--   3. 画面の入口 (middleware) が使う判定の関数 auth_tenant_suspended()
-- 画面の入口とエッジの受け口 (device token) はアプリ側で止める (src/middleware.ts・lib/edge/device-auth.ts)。
-- service_role・運営 (super_admin・テナントを持たない) には影響しない。

create or replace function public.tenant_is_suspended(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_tenant is not null and exists (
    select 1 from public.tenants t where t.id = p_tenant and t.status = 'suspended')
$$;
comment on function public.tenant_is_suspended(uuid) is 'テナントが停止 (suspended) か。';
revoke all on function public.tenant_is_suspended(uuid) from public;
grant execute on function public.tenant_is_suspended(uuid) to authenticated, service_role;

-- 今の利用者 (またはエッジのトークン) のテナントが停止しているか
create or replace function public.auth_tenant_suspended()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.tenant_is_suspended(
           (select u.tenant_id from public.admin_users u where u.auth_user_id = auth.uid() limit 1))
      or public.tenant_is_suspended(public.jwt_edge_tenant_id())
$$;
comment on function public.auth_tenant_suspended() is
  '今の利用者かエッジのトークンのテナントが停止しているか (middleware とポリシーが使う)。';
revoke all on function public.auth_tenant_suspended() from public;
grant execute on function public.auth_tenant_suspended() to authenticated;

do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity and not c.relispartition
       and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polpermissive)
  loop
    execute format('drop policy if exists tenant_active_only on public.%I', t);
    execute format(
      'create policy tenant_active_only on public.%I as restrictive for all to authenticated '
      'using (not (select public.auth_tenant_suspended())) with check (not (select public.auth_tenant_suspended()))', t);
  end loop;
end $$;

-- 拠点の SSO: 拠点のテナントが停止していたら gvms_role を載せない (20260926120000 の関数に足す)
create or replace function public.gvms_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  claims    jsonb := event->'claims';
  cid       text  := claims->>'client_id';
  uid       uuid  := (event->>'user_id')::uuid;
  store     uuid;
  tenant    uuid;
  au        record;
  gvms_role text;
begin
  if cid is null then
    return event;  -- 通常のログイン（OAuth でない）は触らない
  end if;
  select e.store_id, s.tenant_id into store, tenant
    from public.gvms_oidc_clients c
    join public.edge_devices e on e.id = c.edge_id
    left join public.stores s on s.id = e.store_id
   where c.client_id = cid;
  if not found then
    return event;  -- G・VMS の拠点のクライアントではない
  end if;
  -- 拠点のテナントが停止していれば、誰にも拠点の役割を載せない (2026-10-29・ASVS 7.4.2)
  if public.tenant_is_suspended(tenant) then
    return event;
  end if;
  select role, tenant_id, coalesce(store_ids, '{}'::uuid[]) as store_ids into au
    from public.admin_users where auth_user_id = uid limit 1;
  if found then
    if au.role = 'super_admin' then
      gvms_role := 'admin';
    elsif au.role = 'tenant_admin' and au.tenant_id is not null and au.tenant_id = tenant then
      gvms_role := 'manager';
    elsif au.role in ('store_manager', 'baggage_manager') and store = any(au.store_ids) then
      gvms_role := 'operator';
    elsif au.role = 'viewer' and store = any(au.store_ids) then
      gvms_role := 'viewer';
    end if;
  end if;
  if gvms_role is not null then
    claims := jsonb_set(claims, '{gvms_role}', to_jsonb(gvms_role));
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;
