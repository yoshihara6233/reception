-- authz 契約テスト用スキーマ（自己完結・Supabase auth を shim で再現）。
-- Phase A / G1「テナント×ロール authz 契約テスト（実DB統合）」。
--
-- 目的: RLS による越権防止(クロステナント漏洩なし)を実DBで実証する。CI の素の
--   Postgres に対し、Supabase の auth.uid()/authenticated ロールを shim で再現し、
--   ベース表(tenants/stores/admin_users)＋検証対象表(edge_devices/recorders/
--   recorder_cameras/live_sessions/session_limits)＋**実際のRLSポリシー**を適用する。
--
-- ⚠ 同期注意: 下の monitor 表のRLSポリシーは supabase/migrations の最終状態
--   (20260519_001 + 20260520_002 で auth_user_id 化) を転記したもの。migration で
--   ポリシーを変更したら本ファイルも更新すること(契約テストの忠実性のため)。
--   ベース表(tenants/stores/admin_users)のRLSは「意図する authz モデル」を表す
--   (reception由来の本番定義と整合しているか別途確認)。

-- ── 全部作り直す(テストは毎回クリーンに) ──
drop schema if exists public cascade;
create schema public;
drop schema if exists auth cascade;
create schema auth;

-- ── Supabase auth shim ──
-- auth.uid(): リクエストの JWT クレーム(request.jwt.claims)の sub を返す。
-- テストは各クエリ前に `set local request.jwt.claims = '{"sub":"<uuid>"}'` する。
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;

-- auth.jwt(): リクエストの JWT クレーム全体を jsonb で返す（edge スコープRLS用）。
-- edge_jobs のRLSは auth.jwt()->'app_metadata'->>'edge_id' を見るため、テストは
-- `set local request.jwt.claims = '{"sub":...,"app_metadata":{"edge_id":...}}'` する。
create or replace function auth.jwt() returns jsonb
  language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create table auth.users ( id uuid primary key );

-- RLS が効く非所有・非superのロール(本番の authenticated 相当)。
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- ── ベース表(reception由来・意図モデルで再現) ──
create table public.tenants (
  id   uuid primary key default gen_random_uuid(),
  name text
);

create table public.stores (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  name      text
);

create table public.admin_users (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  role         text not null check (role in ('super_admin','tenant_admin','store_manager')),
  tenant_id    uuid,
  store_ids    uuid[] not null default '{}'
);

-- ── 検証対象表(monitor migration のサブセット・RLSに必要な列のみ) ──
create table public.edge_devices (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  name         text,
  status       text not null default 'offline',
  last_seen_at timestamptz
);

create table public.recorders (
  id      uuid primary key default gen_random_uuid(),
  edge_id uuid not null references public.edge_devices(id) on delete cascade,
  vendor  text,
  host    text
);

create table public.recorder_cameras (
  id          uuid primary key default gen_random_uuid(),
  recorder_id uuid not null references public.recorders(id) on delete cascade,
  channel     int,
  name        text
);

create table public.live_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  store_id   uuid,
  mode       text,
  started_at timestamptz not null default now()
);

create table public.session_limits (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  max_concurrent int not null default 5
);

-- enrollment_tokens（DR2）: RLS 有効・ポリシー無し ＝ service_role のみ。
-- authenticated セッションからは一切読めない（トークン漏洩面を作らない）契約。
create table public.enrollment_tokens (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  store_id    uuid not null references public.stores(id) on delete cascade,
  tenant_id   uuid not null,
  name        text not null,
  camera_tier int not null default 16,
  edge_id     uuid references public.edge_devices(id) on delete set null,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

-- edge_jobs（Phase B1）: service_role=全可 / authenticated(エッジ scoped トークン)=
-- 自分の edge_id 行のみ SELECT/UPDATE。app_metadata.edge_id でスコープ。
create table public.edge_jobs (
  id         uuid primary key default gen_random_uuid(),
  edge_id    uuid not null references public.edge_devices(id) on delete cascade,
  kind       text not null default 'connection_test',
  status     text not null default 'pending',
  result     jsonb,
  created_at timestamptz not null default now()
);

-- jalert_receipts（20260626_001 + 20260630_001 転記）: 全国 J-Alert 受信ログ＝店舗非依存。
-- ログイン中の管理ユーザは全員 SELECT 可。書込は service_role のみ（ポリシー無し）。
-- 判定は auth_user_id（id 誤用だと全行不可視＝/bcp/jalerts がゼロ表示になる回帰を防ぐ）。
create table public.jalert_receipts (
  id                  uuid primary key default gen_random_uuid(),
  alert_source        text not null unique,
  alert_type          text,
  title               text,
  max_intensity       text,
  area_codes          text[],
  alert_issued_at     timestamptz,
  received_at         timestamptz not null default now(),
  matched_store_count int not null default 0,
  detail_url          text,
  created_at          timestamptz not null default now()
);

-- ── 権限(authenticated にテーブルアクセス付与・RLSで絞る) ──
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.jwt() to authenticated;
grant select on auth.users to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ===========================================================================
-- RLS ポリシー
-- ===========================================================================
alter table public.admin_users     enable row level security;
alter table public.stores          enable row level security;
alter table public.tenants         enable row level security;
alter table public.edge_devices    enable row level security;
alter table public.recorders       enable row level security;
alter table public.recorder_cameras enable row level security;
alter table public.live_sessions   enable row level security;
alter table public.session_limits  enable row level security;
alter table public.enrollment_tokens enable row level security;   -- ポリシー無し=全拒否

-- admin_users: 自分の行のみ(本番 admin_users_self_select 相当)。
create policy admin_users_self_select on public.admin_users
  for select using (auth_user_id = auth.uid());

-- tenants: 自テナント or super_admin(意図モデル)。
create policy tenants_select on public.tenants
  for select using (
    exists (select 1 from public.admin_users u where u.auth_user_id = auth.uid()
      and (u.role = 'super_admin' or u.tenant_id = tenants.id))
  );

-- stores: super_admin=全件 / tenant_admin=自テナント / store_manager=store_ids(意図モデル)。
create policy stores_select on public.stores
  for select using (
    exists (select 1 from public.admin_users u where u.auth_user_id = auth.uid()
      and (
        u.role = 'super_admin'
        or (u.role = 'tenant_admin' and u.tenant_id = stores.tenant_id)
        or (u.role = 'store_manager' and stores.id = any(u.store_ids))
      ))
  );

-- ── 以下は supabase/migrations(20260519_001 + 20260520_002 fix)の転記 ──

-- edge_devices
create policy "edges_select" on public.edge_devices
  for select using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid()
        and (
          u.role = 'super_admin'
          or exists (select 1 from public.stores s
                     where s.id = edge_devices.store_id
                       and (u.role = 'tenant_admin' and s.tenant_id in (
                              select tenant_id from public.admin_users where auth_user_id = auth.uid()
                            ))
                          or edge_devices.store_id = any(u.store_ids)
                    )
        )
    )
  );
-- edges_modify: 20260621_003 修正後(select と同じ可視範囲にスコープ)。
create policy "edges_modify" on public.edge_devices
  for all
  using (
    exists (select 1 from public.admin_users u
      where u.auth_user_id = auth.uid()
        and (u.role = 'super_admin'
          or exists (select 1 from public.stores s
                     where s.id = edge_devices.store_id
                       and (u.role = 'tenant_admin' and s.tenant_id in (
                              select tenant_id from public.admin_users where auth_user_id = auth.uid()))
                          or edge_devices.store_id = any(u.store_ids))))
  )
  with check (
    exists (select 1 from public.admin_users u
      where u.auth_user_id = auth.uid()
        and (u.role = 'super_admin'
          or exists (select 1 from public.stores s
                     where s.id = edge_devices.store_id
                       and (u.role = 'tenant_admin' and s.tenant_id in (
                              select tenant_id from public.admin_users where auth_user_id = auth.uid()))
                          or edge_devices.store_id = any(u.store_ids))))
  );

-- recorders: edge_devices の可視性に連鎖
create policy "recorders_select" on public.recorders
  for select using (exists (select 1 from public.edge_devices e where e.id = recorders.edge_id));
create policy "recorders_modify" on public.recorders
  for all
  using (exists (select 1 from public.edge_devices e where e.id = recorders.edge_id))
  with check (exists (select 1 from public.edge_devices e where e.id = recorders.edge_id));

-- recorder_cameras: recorders の可視性に連鎖
create policy "cameras_select" on public.recorder_cameras
  for select using (exists (select 1 from public.recorders r where r.id = recorder_cameras.recorder_id));
create policy "cameras_modify" on public.recorder_cameras
  for all
  using (exists (select 1 from public.recorders r where r.id = recorder_cameras.recorder_id))
  with check (exists (select 1 from public.recorders r where r.id = recorder_cameras.recorder_id));

-- live_sessions: 自分 or super_admin or テナント/店舗スコープ(20260621_003 修正後)
create policy "sessions_select" on public.live_sessions
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.admin_users u where u.auth_user_id = auth.uid() and u.role = 'super_admin')
    or exists (
      select 1 from public.admin_users u
      join public.stores s on s.id = live_sessions.store_id
      where u.auth_user_id = auth.uid()
        and ((u.role = 'tenant_admin' and s.tenant_id = u.tenant_id)
          or (u.role = 'store_manager' and s.id = any(u.store_ids)))
    )
  );
create policy "sessions_insert" on public.live_sessions
  for insert with check (user_id = auth.uid());

-- session_limits
create policy "limits_select" on public.session_limits
  for select using (
    exists (select 1 from public.admin_users u
      where u.auth_user_id = auth.uid()
        and (u.role = 'super_admin' or u.tenant_id = session_limits.tenant_id))
  );
create policy "limits_modify" on public.session_limits
  for all
  using (exists (select 1 from public.admin_users u where u.auth_user_id = auth.uid()
           and (u.role = 'super_admin' or (u.role = 'tenant_admin' and u.tenant_id = session_limits.tenant_id))))
  with check (exists (select 1 from public.admin_users u where u.auth_user_id = auth.uid()
           and (u.role = 'super_admin' or (u.role = 'tenant_admin' and u.tenant_id = session_limits.tenant_id))));

-- edge_jobs（Phase B1・20260629_001 転記）: エッジ scoped トークンは自分の edge_id 行のみ。
alter table public.edge_jobs enable row level security;
create policy edge_jobs_edge_select on public.edge_jobs
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid = edge_id);
create policy edge_jobs_edge_update on public.edge_jobs
  for update to authenticated
  using      ((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid = edge_id)
  with check ((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid = edge_id);

-- jalert_receipts（20260626_001 + 20260630_001 転記）: ログイン中の管理ユーザは全員閲覧可。
alter table public.jalert_receipts enable row level security;
create policy jalert_receipts_select on public.jalert_receipts
  for select using (
    exists (select 1 from public.admin_users u where u.auth_user_id = auth.uid())
  );
