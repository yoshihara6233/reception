-- 要望の収集 第 2 段（D-2-22）— 使われ方の 1 日の集計の受け口。
--
-- 設計: NVMS/docs/NVMS_要望の収集_基本設計.html §4・§7
-- 接続仕様: NVMS/docs/GVMS_CLOUD_SPEC.md §12.4
--
-- 拠点の G・VMS が毎日 3:00〜4:00 に前日分を POST /api/edge/usage で送る。1 拠点 1 日 1 行で、
-- 同じ日の送り直しは上書き。中身は数と分布だけ（名前・IP・映像・個々の操作の記録は入らない）。
-- 受け口が知らない項目は捨ててから保存する。25 か月で消す（/api/cron/feedback-attachments）。
--
-- **約款（G-6）の施行前は受け付けない。** 受け口は環境変数 GVMS_USAGE_INTAKE=on のときだけ
-- 保存し、それ以外は 409 usage_disabled を返す（tenants.usage_enabled は既定 true のため、
-- 受け口だけで閉じておく）。
--
-- 読めるのは運営（super_admin）だけ。テナントには見せない（集計は運営が開発と推奨構成の判断に使う）。
-- 書き込みは API（service role）から。

create table if not exists public.edge_usage_reports (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  store_id      uuid references public.stores(id) on delete set null,
  edge_id       uuid not null references public.edge_devices(id) on delete cascade,
  -- 拠点の現地時刻の日（前日分）
  day           date not null,
  schema        integer not null check (schema >= 1),
  agent_version text check (agent_version is null or char_length(agent_version) <= 64),
  -- 受け口で知らない項目を捨てた後の本文（§12.4 の features / errors / cameras / load / clients / doctor）
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  unique (edge_id, day)
);

comment on table public.edge_usage_reports is
  '使われ方の 1 日の集計（GVMS_CLOUD_SPEC §12.4・D-2-22）。1 拠点 1 日 1 行・送り直しは上書き・25 か月で消す。運営だけが読む。';

create index if not exists edge_usage_reports_day_idx on public.edge_usage_reports (day);
create index if not exists edge_usage_reports_tenant_day_idx on public.edge_usage_reports (tenant_id, day);

alter table public.edge_usage_reports enable row level security;

drop policy if exists edge_usage_reports_select on public.edge_usage_reports;
create policy edge_usage_reports_select on public.edge_usage_reports
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid() and u.role = 'super_admin'
    )
  );
