-- 要望の収集 第 1 段（D-2-21）— テナント管理者が「返事を見た」時刻。
--
-- 設計: NVMS/docs/NVMS_要望の収集_基本設計.html §3.6
--   「返事が付いた・状態が変わったときは、管理者の画面の入口に件数の印を出す」
--
-- 利用者ごとに、送った要望の一覧（/settings/feedback）を最後に開いた時刻を 1 行持つ。
-- 件数の印 = 自分のテナントの要望のうち、この時刻より後に状態・返事・対応の版が
-- 変わったもの（feedback_items.updated_at はその 3 つが変わったときだけ進む）。
--
-- 要望 1 件ごとに「見た」を持たないのは、テナント管理者が複数いるとき、
-- ひとりが開いただけで他の管理者の印まで消えないようにするため（利用者ごとに持つ）。
--
-- 書き込みは API（service role）だけ。利用者は自分の行だけを読める。

create table if not exists public.feedback_seen (
  -- auth.users.id。admin_users と同じく auth.users への外部キーは張らない。
  auth_user_id uuid primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  seen_at      timestamptz not null default now()
);

comment on table public.feedback_seen is
  'テナント管理者が送った要望の一覧（/settings/feedback）を最後に開いた時刻。左メニューの「要望」の件数の印に使う（基本設計 §3.6）。';

create index if not exists feedback_seen_tenant_idx on public.feedback_seen (tenant_id);

alter table public.feedback_seen enable row level security;

-- 自分の行だけ・自分のテナントの tenant_admin のときだけ読める（テナント内に閉じる）。
drop policy if exists feedback_seen_select on public.feedback_seen;
create policy feedback_seen_select on public.feedback_seen
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    and exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid()
        and u.role = 'tenant_admin'
        and u.tenant_id = feedback_seen.tenant_id
    )
  );

-- 書き込みポリシーは置かない（service role の API だけが書く）。
