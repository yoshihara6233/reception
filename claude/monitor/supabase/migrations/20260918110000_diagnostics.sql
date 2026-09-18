-- 保守自動化①・案A: 診断バンドルの遠隔取得（NVMS/docs/DIAGNOSTICS_SPEC.md §2）。
--
-- 発行（管理画面）→ pending_command 'collect_diagnostics' → nvmsd が
-- tar.gz を presigned PUT → commands/result の ok=true で「到着」と扱う
-- （完了通知の専用エンドポイントは作らない — 仕様 §2.3）。
--
-- diagnostic_bundles は発行時に pending で先置きし、request_id を
-- upload-url の認可（勝手なパスに書かせない）と結果の突き合わせに使う。
-- バンドルは 30 日で削除（発行時に古い行と実体を掃除する運用）。

create table if not exists public.diagnostic_bundles (
  request_id   uuid primary key,
  edge_id      uuid not null references public.edge_devices(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'completed', 'failed')),
  bytes        bigint,
  storage_path text,
  error        text,
  requested_by uuid,
  created_at   timestamptz not null default now(),
  uploaded_at  timestamptz
);

create index if not exists diagnostic_bundles_edge_idx
  on public.diagnostic_bundles (edge_id, created_at desc);

alter table public.diagnostic_bundles enable row level security;

-- super_admin のみ（発行・ダウンロードとも運営の道具。書き込みの実体は service）。
drop policy if exists diagnostic_bundles_admin on public.diagnostic_bundles;
create policy diagnostic_bundles_admin on public.diagnostic_bundles
  using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid() and u.role = 'super_admin'
    )
  );

-- 非公開バケット。上限は仕様の 50 MiB ＋ 余裕（受け口側で 50 MiB に締める）。
insert into storage.buckets (id, name, public, file_size_limit)
values ('diagnostics', 'diagnostics', false, 62914560)
on conflict (id) do nothing;
