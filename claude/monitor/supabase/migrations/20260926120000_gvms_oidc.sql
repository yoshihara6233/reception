-- ログインの一本化（G・VMS の拠点がクラウドを OIDC の発行元にする・GVMS_CLOUD_SPEC §9・D-2-17）。
--
-- 1. gvms_oidc_clients: 拠点（edge）ごとに登録した OAuth のクライアント。拠点が heartbeat で
--    申告した戻り先（oidc_redirect_uris）で公開クライアント（秘密なし・PKCE 必須）を登録し、
--    その client_id を設定の配送（GET /api/edge/config の oidc）で拠点へ渡す。
-- 2. gvms_access_token_hook: Supabase Auth の custom access token hook。**G・VMS の拠点の
--    クライアントへ出すトークンにだけ** gvms_role（拠点で使うロール）を載せる。
--    テナントに属さない利用者には載せない（拠点は 403 で断る）。
--
-- 本番で使うには、ダッシュボードで OAuth 2.1 Server を有効にし、署名鍵を非対称鍵
-- （ES256 / RS256）へ切り替え、Auth Hooks の custom access token にこの関数を選ぶ。

create table if not exists public.gvms_oidc_clients (
  edge_id       uuid primary key references public.edge_devices(id) on delete cascade,
  client_id     text not null unique,
  redirect_uris text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- サービスロールだけが触る（管理 API・heartbeat・配送）。画面から直接は読ませない
alter table public.gvms_oidc_clients enable row level security;

comment on table public.gvms_oidc_clients is
  'G・VMS の拠点ごとの OAuth クライアント（ログインの一本化・GVMS_CLOUD_SPEC §9）。'
  'heartbeat の oidc_redirect_uris で登録・更新し、拠点が名乗りを外したら消す。';

-- 拠点で使うロールへの読み替え（2026-09-26 暫定・利用者の確認待ち）:
--   super_admin                          → admin    （拠点は既定で manager に留める）
--   tenant_admin（その店舗のテナント）      → manager
--   store_manager / baggage_manager（担当店舗）→ operator
--   viewer（担当店舗）                    → viewer
--   それ以外                              → 載せない（拠点に入れない）
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

-- Auth のフックは supabase_auth_admin で呼ばれる。ほかのロールからは呼ばせない
grant usage on schema public to supabase_auth_admin;
grant execute on function public.gvms_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.gvms_access_token_hook(jsonb) from authenticated, anon, public;
