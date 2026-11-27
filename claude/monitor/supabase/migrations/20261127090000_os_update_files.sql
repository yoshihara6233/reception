-- OS 更新ファイルの配信（G・VMS-Cloud 接続仕様 §14・NVMS/docs/GVMS_CLOUD_SPEC.md・WBS E-4-8）。
--
-- 当社が署名した OS 更新ファイル（nvmsosu1.<本文>.<署名> の 1 行）を運営が登録し、
-- 届ける拠点を選ぶ。拠点（G・VMS 1.0.0 以降・os_update を名乗る）は GET /api/edge/os-update で
-- 受け取り、署名を確かめて画面に出す。**届いても当たらない**（始めるのは拠点の管理者）。
--
-- 届け先は edge_devices.os_update_file_id に持つ（1 拠点に届けるのはいちばん新しく選んだ 1 つ）。
-- 取り下げは withdrawn_at を入れる（消さない・何をいつ届けたかを残す）。
-- 読むのは運営（super_admin）だけ。書くのはサーバ（service role）だけ。
-- 冪等: create table if not exists・add column if not exists・drop policy if exists。

create table if not exists public.os_update_files (
  id           uuid        primary key default gen_random_uuid(),
  file_id      text        not null unique,
  title        text        not null,
  advisory     text,
  cve          text,
  issued_at    text,
  packages     jsonb       not null,
  reboot       boolean     not null default false,
  signed       text        not null check (char_length(signed) <= 65536),
  notes        text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  withdrawn_at timestamptz
);

alter table public.os_update_files enable row level security;

drop policy if exists os_update_files_select_super on public.os_update_files;
create policy os_update_files_select_super on public.os_update_files
  for select to authenticated
  using ((select public.auth_user_role()) = 'super_admin');

-- RESTRICTIVE の層 (20261029090000・20261029120000・20261029170000・20261030090000 と同じ式)
drop policy if exists first_party_only on public.os_update_files;
create policy first_party_only on public.os_update_files as restrictive for all to authenticated
  using (public.jwt_is_first_party()) with check (public.jwt_is_first_party());
drop policy if exists mfa_aal2_only on public.os_update_files;
create policy mfa_aal2_only on public.os_update_files as restrictive for all to authenticated
  using ((select public.jwt_mfa_satisfied())) with check ((select public.jwt_mfa_satisfied()));
drop policy if exists tenant_active_only on public.os_update_files;
create policy tenant_active_only on public.os_update_files as restrictive for all to authenticated
  using (not (select public.auth_tenant_suspended())) with check (not (select public.auth_tenant_suspended()));
drop policy if exists user_active_only on public.os_update_files;
create policy user_active_only on public.os_update_files as restrictive for all to authenticated
  using (not (select public.auth_user_blocked())) with check (not (select public.auth_user_blocked()));

alter table public.edge_devices
  add column if not exists os_update_file_id     uuid references public.os_update_files(id) on delete set null,
  add column if not exists os_update_assigned_at timestamptz;

comment on table public.os_update_files is
  'OS 更新ファイルの台帳（§14）。signed は当社の署名つきの 1 行そのもの（作り変えない）。書くのは service role だけ。';
comment on column public.os_update_files.file_id is '本文の id（例 GVMS-SA-2026-001-U1）。';
comment on column public.os_update_files.withdrawn_at is '取り下げた時刻。入っていれば拠点へ返さない。';
comment on column public.edge_devices.os_update_file_id is
  'この拠点へ届ける OS 更新ファイル（§14）。null=届けるものは無い。';
comment on column public.edge_devices.os_update_assigned_at is 'os_update_file_id を最後に変えた時刻。';
