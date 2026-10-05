-- 要望の収集 第 1 段（D-2-21）— 要望の受付と返事。
--
-- 設計: NVMS/docs/NVMS_要望の収集_基本設計.html §3・§7
-- 接続仕様: NVMS/docs/GVMS_CLOUD_SPEC.md §12（12.1〜12.3）
--
-- ① feedback_topics — 運営が束ねた「話題」。状態・返事・対応の版・WBS・課題 URL・内部メモ。
--    **運営 (super_admin) だけが読む。** 内部メモをテナントへ見せないため、テナントには
--    要望 (feedback_items) の status / reply / fixed_version として返す。
-- ② feedback_items — 1 件 = 1 つの要望。現場 (source=gvms)・クラウドの画面 (cloud)・
--    閉域の拠点のファイル (import) から入る。テナント管理者は自分のテナントの分だけ読める。
-- ③ feedback_events — 状態・返事・束ね先の変更の記録（誰が・いつ・前後の値）。運営だけが読む。
-- ④ tenants.feedback_enabled / usage_enabled — テナントで止める設定（usage は第 2 段で使う）。
--
-- 書き込みはすべて API（service role）から。利用者からの直接の書き込みポリシーは置かない。

-- ── ④ テナントの止める設定 ─────────────────────────────────────────────
alter table public.tenants
  add column if not exists feedback_enabled boolean not null default true,
  add column if not exists usage_enabled    boolean not null default true;

comment on column public.tenants.feedback_enabled is
  '要望の受付（GVMS_CLOUD_SPEC §12.1）。false のとき /api/edge/feedback は 409 feedback_disabled、クラウドの画面の入口も出さない。';
comment on column public.tenants.usage_enabled is
  '使われ方の集計の受付（GVMS_CLOUD_SPEC §12.4・第 2 段）。false のとき /api/edge/usage は 409 usage_disabled。';

-- ── ① 話題 ───────────────────────────────────────────────────────────
create table if not exists public.feedback_topics (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 200),
  description   text,
  status        text not null default 'reviewing'
                  check (status in ('received','reviewing','planned','done','declined','answered')),
  -- 束ねた要望へそのまま写す返事（現場の画面に文として出る）。
  reply         text check (reply is null or char_length(reply) <= 1000),
  fixed_version text check (fixed_version is null or char_length(fixed_version) <= 64),
  wbs_ref       text check (wbs_ref is null or char_length(wbs_ref) <= 32),
  issue_url     text check (issue_url is null or char_length(issue_url) <= 500),
  -- 運営の内部メモ。テナントへは出さない（このテーブルは super_admin だけが読める）。
  internal_note text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- 見送りは理由（返事）が必須（基本設計 §3.6）。
  constraint feedback_topics_declined_reply
    check (status <> 'declined' or (reply is not null and length(btrim(reply)) > 0))
);

create index if not exists feedback_topics_updated_idx on public.feedback_topics (updated_at desc);

drop trigger if exists trg_feedback_topics_updated_at on public.feedback_topics;
create trigger trg_feedback_topics_updated_at
  before update on public.feedback_topics
  for each row execute function public.touch_updated_at();

-- ── ② 要望 ───────────────────────────────────────────────────────────
create table if not exists public.feedback_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- クラウドの画面から送った要望は拠点に属さない（null）。
  store_id      uuid references public.stores(id) on delete set null,
  -- 現場 (source=gvms) から来たときの窓口ノード。クラウド・ファイル取り込みは null。
  edge_id       uuid references public.edge_devices(id) on delete set null,
  source        text not null check (source in ('gvms','cloud','import')),
  -- 現場の手元の id（G・VMS の feedback.id）。送り直しの重複を除くのに使う。
  local_id      uuid,
  -- クラウドの画面から送ったときの利用者（auth.users.id）。現場からは誰が書いたかを受けない（§12.1）。
  submitted_by  uuid,
  kind          text not null check (kind in ('request','bug','question','other')),
  urgency       text not null check (urgency in ('blocking','inconvenient','nice_to_have')),
  -- 電話番号・メールアドレス・URL・IP アドレスを伏せ字にした後の本文（元の文は残さない・§7）。
  body          text not null check (char_length(body) between 1 and 1000),
  contact_ok    boolean not null default false,
  -- 送った人の役割（現場は admin・クラウドは tenant_admin）。名前は持たない。
  role          text,
  -- 自動で添える項目（既知の項目だけ・4 KB まで。API で絞る）。
  context       jsonb not null default '{}'::jsonb,
  topic_id      uuid references public.feedback_topics(id) on delete set null,
  status        text not null default 'received'
                  check (status in ('received','reviewing','planned','done','declined','answered')),
  reply         text check (reply is null or char_length(reply) <= 1000),
  fixed_version text check (fixed_version is null or char_length(fixed_version) <= 64),
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  -- **状態・返事・対応の版が変わったときだけ進む**（下のトリガ）。
  -- 現場は GET /api/edge/feedback/status?since= でこの列の差分を取る（§12.3）。
  updated_at    timestamptz not null default now(),
  constraint feedback_items_declined_reply
    check (status <> 'declined' or (reply is not null and length(btrim(reply)) > 0)),
  constraint feedback_items_context_size
    check (pg_column_size(context) <= 4096)
);

comment on column public.feedback_items.updated_at is
  '状態 (status)・返事 (reply)・対応の版 (fixed_version) が変わったときだけ進む。現場の差分取得 (§12.3) の基準。';

-- 現場の送り直しで増えない: 同じ窓口ノード × 同じ手元の id は 1 件。
create unique index if not exists feedback_items_edge_local_uidx
  on public.feedback_items (edge_id, local_id)
  where edge_id is not null and local_id is not null;

-- 状態の差分取得（§12.3）: その拠点の updated_at 順。
create index if not exists feedback_items_edge_updated_idx
  on public.feedback_items (edge_id, updated_at)
  where edge_id is not null;
-- ファイル取り込みの重複除去と、拠点ごとの絞り込み。
create index if not exists feedback_items_store_local_idx
  on public.feedback_items (store_id, local_id);
-- テナントの一覧・要望ボードの新着順。
create index if not exists feedback_items_tenant_created_idx
  on public.feedback_items (tenant_id, created_at desc);
create index if not exists feedback_items_topic_idx
  on public.feedback_items (topic_id) where topic_id is not null;
-- 1 利用者 1 日の上限（クラウドの画面）。
create index if not exists feedback_items_submitter_created_idx
  on public.feedback_items (submitted_by, created_at) where submitted_by is not null;

-- updated_at は「現場へ返す値」が変わったときだけ進める。
-- clock_timestamp() を使うのは、話題の状態を変えて束ねた要望を 1 文でまとめて
-- 更新したとき、全行が同じ now()（トランザクション開始時刻）になって
-- 差分取得のページ境界（next_since）で取りこぼすのを避けるため。
create or replace function public.feedback_items_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status        is distinct from old.status
  or new.reply         is distinct from old.reply
  or new.fixed_version is distinct from old.fixed_version then
    new.updated_at := clock_timestamp();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_feedback_items_updated_at on public.feedback_items;
create trigger trg_feedback_items_updated_at
  before update on public.feedback_items
  for each row execute function public.feedback_items_touch_updated_at();

-- ── ③ 変更の記録 ─────────────────────────────────────────────────────
create table if not exists public.feedback_events (
  id            bigint generated always as identity primary key,
  item_id       uuid references public.feedback_items(id) on delete cascade,
  topic_id      uuid references public.feedback_topics(id) on delete cascade,
  actor_user_id uuid,
  -- 'item.update' / 'item.bundle' / 'topic.create' / 'topic.update' / 'topic.cascade' など
  action        text not null,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now(),
  constraint feedback_events_target check (item_id is not null or topic_id is not null)
);

create index if not exists feedback_events_item_idx  on public.feedback_events (item_id, created_at);
create index if not exists feedback_events_topic_idx on public.feedback_events (topic_id, created_at);

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.feedback_topics enable row level security;
alter table public.feedback_items  enable row level security;
alter table public.feedback_events enable row level security;

-- 要望: 運営は全部・テナント管理者は自分のテナントだけ。
-- store_manager / viewer / baggage_manager は読めない（送れるのはテナント管理者だけ・§3.1）。
drop policy if exists feedback_items_select on public.feedback_items;
create policy feedback_items_select on public.feedback_items
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid()
        and (
          u.role = 'super_admin'
          or (u.role = 'tenant_admin' and u.tenant_id = feedback_items.tenant_id)
        )
    )
  );

-- 話題: 運営だけ（内部メモ・WBS・課題 URL をテナントへ出さない）。
drop policy if exists feedback_topics_select on public.feedback_topics;
create policy feedback_topics_select on public.feedback_topics
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid() and u.role = 'super_admin'
    )
  );

-- 変更の記録: 運営だけ。
drop policy if exists feedback_events_select on public.feedback_events;
create policy feedback_events_select on public.feedback_events
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid() and u.role = 'super_admin'
    )
  );

-- 書き込みポリシーは置かない（service role の API だけが書く）。
