-- 第1弾 A4: ライセンスのクラウド管理（NVMS/docs/LICENSE_SPEC.md）。
--
-- OTA（nvmsd_releases）とまったく同じ分離: クラウドは「発行管理・台帳・配送」に徹し、
-- ライセンスの正当性は **G・VMS 署名**を nvmsd が埋め込み公開鍵で検証して担保する。
-- クラウドは署名済みライセンス（既存形式）を**不透明な文字列として保管・配送**する
-- （中身は解釈しない＝OTA の sig と同じ透過運用）。
--
-- ① licenses — 拠点（edge）ごとのライセンス台帳。メタ（組織・最大台数・期限）は
--    表示/期限管理/残数管理のためにクラウドが持ち、強制の実体は blob（G・VMS 署名）。
-- ② edge_devices.reported_mac — nvmsd が申告する機器の MAC（署名の束縛対象）。
--    管理者はこれを見て G・VMS にライセンス発行を依頼する（enroll → MAC 申告 → 署名 → 登録）。

alter table public.edge_devices
  add column if not exists reported_mac text;

comment on column public.edge_devices.reported_mac is
  'nvmsd が申告する機器の MAC（ライセンス束縛の対象）。heartbeat で更新。';

create table if not exists public.licenses (
  id            uuid primary key default gen_random_uuid(),
  edge_id       uuid not null references public.edge_devices(id) on delete cascade,
  store_id      uuid references public.stores(id) on delete set null,
  tenant_id     uuid not null,
  -- 表示・期限管理・残数管理用のメタ（強制の実体は blob。ここは台帳の見出し）。
  org_name      text,
  max_cameras   int,
  expires_at    date,
  bound_mac     text,
  notes         text,
  -- G・VMS 署名済みライセンス（既存形式・不透明文字列）。クラウドは解釈しない。
  license_blob  text not null,
  -- 配送の版。管理画面の更新ごとに +1。nvmsd は版が変わった時だけ取り込む。
  license_version int not null default 1,
  status        text not null default 'active' check (status in ('active','revoked')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 1 エッジ（窓口ノード）につき有効ライセンスは1つ。差し替えは同じ行を更新して版を上げる。
create unique index if not exists licenses_edge_active_idx
  on public.licenses (edge_id) where status = 'active';
create index if not exists licenses_tenant_idx on public.licenses (tenant_id);

alter table public.licenses enable row level security;

-- 閲覧: テナントに属する管理ロール（自テナントのみ）。RLS はテナント境界を担保。
drop policy if exists licenses_select on public.licenses;
create policy licenses_select on public.licenses
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid()
        and (u.role = 'super_admin' or u.tenant_id = licenses.tenant_id)
    )
  );

-- 変更: 実体は service（発行/更新/失効の管理 API）経由。利用者からの直接変更は無し。
drop policy if exists licenses_modify on public.licenses;
create policy licenses_modify on public.licenses
  using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid()
        and u.role in ('super_admin','tenant_admin')
        and (u.role = 'super_admin' or u.tenant_id = licenses.tenant_id)
    )
  );
