-- 利用約款への同意の記録（2026-11-06・G・VMS の WBS G-9・約款の本体 第 4 条 2 項・3 項）。
--
-- テナント管理者が初めてログインしたときと、約款の版（環境変数 TERMS_VERSION）が上がったあとに
-- 同意の画面（/login/terms）を出し、「同意する」を押したら 1 行足す。
-- **消さない・書き換えない**（定型約款の組入れの証拠）。書くのはサーバ（service role）だけで、
-- 利用者は自分の行だけ読める（middleware が「もう同意したか」を自分のトークンで確かめる）。
-- 利用者を消しても行は残す（user_id は外部キーにしない）。

create table if not exists public.terms_consents (
  id            bigserial   primary key,
  terms_version text        not null,
  user_id       uuid        not null,
  tenant_id     uuid,
  accepted_at   timestamptz not null default now(),
  ip            text        not null default '',
  user_agent    text        not null default ''
);
create index if not exists terms_consents_user on public.terms_consents (user_id, terms_version);

alter table public.terms_consents enable row level security;

drop policy if exists terms_consents_select_own on public.terms_consents;
create policy terms_consents_select_own on public.terms_consents
  for select to authenticated
  using (user_id = auth.uid() or public.auth_user_role() = 'super_admin');

comment on table public.terms_consents is
  '利用約款への同意の記録（G-9）。消さない。書くのは service role だけ。';
