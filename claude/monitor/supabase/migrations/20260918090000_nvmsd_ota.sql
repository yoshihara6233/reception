-- 保守自動化②: nvmsd の自動バージョンアップ（NVMS/docs/OTA_SPEC.md）。
--
-- ① nvmsd_releases — G・VMS が Ed25519 で署名したリリースの台帳。
--    クラウドは「配送路」に徹する: バイナリと署名を保管して presigned URL で
--    渡すだけで、正当性の検証は nvmsd が埋め込み公開鍵で行う（クラウド侵害が
--    偽バイナリ配布に化けないための分離。OTA_SPEC §1）。
-- ② edge_devices の更新時間帯（JST・null = 既定 02:00-05:00）と
--    「今すぐ更新」フラグ（時間帯を無視する 1 回きりの指示。適用確認で自動解除）。
--    目標バージョンは既存の desired_agent_version を再利用する（nvmsd エッジは
--    bootstrap を呼ばないため衝突しない。agent_version の nvmsd/ 接頭辞で見分く）。
-- ③ 非公開バケット nvmsd-releases（アクセスは service role 発行の signed URL のみ）。

create table if not exists public.nvmsd_releases (
  id           uuid primary key default gen_random_uuid(),
  version      text not null unique,
  storage_path text not null,
  -- Ed25519 署名（base64）。クラウドは検証しない — 保管して配るだけ。
  sig          text not null,
  -- サーバがアップロード実体から計算した値（申告値は信じない）。
  sha256       text not null,
  bytes        bigint not null,
  notes        text,
  created_at   timestamptz not null default now()
);

alter table public.nvmsd_releases enable row level security;

-- super_admin のみ（登録・削除の実体は service role 経由の管理 API）。
drop policy if exists nvmsd_releases_admin on public.nvmsd_releases;
create policy nvmsd_releases_admin on public.nvmsd_releases
  using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid() and u.role = 'super_admin'
    )
  );

alter table public.edge_devices
  add column if not exists update_window_start time,
  add column if not exists update_window_end   time,
  add column if not exists update_force        boolean not null default false;

comment on column public.edge_devices.update_window_start is
  'nvmsd 自動更新の許可時間帯の開始（JST）。null = 既定 02:00。';
comment on column public.edge_devices.update_window_end is
  'nvmsd 自動更新の許可時間帯の終了（JST）。null = 既定 05:00。';
comment on column public.edge_devices.update_force is
  'true = 次回ポーリングで時間帯を無視して更新指示（検証拠点用）。適用確認で自動解除。';

insert into storage.buckets (id, name, public, file_size_limit)
values ('nvmsd-releases', 'nvmsd-releases', false, 209715200)
on conflict (id) do nothing;
