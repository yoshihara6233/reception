-- nvmsd OTA の配布物を形式（deb / rpm）× CPU 種別（amd64 / arm64）で配り分ける
-- （G・VMS 依頼 MEMO_20260924_OTA形式の配り分け・OTA_SPEC 付録）。
--
-- 署名は版と arch を縛る（マニフェスト内）。nvmsd は「署名の中の版 = クラウドの名乗り」
-- を検証するので、版名を 0.1.66-rpm のように変えての二重登録はできない（意図どおり）。
-- そこで 1 つの版に形式・arch ごとの配布物を持たせ、キーを (版・形式・arch) にする。
--
-- 既存行（すべて Ubuntu 向け deb・amd64）は既定値でそのまま deb/amd64 になる。
-- 拠点の形式は heartbeat の名乗り（pkg_format / pkg_arch）。名乗りの無い拠点
-- （0.1.66 以前）は deb / amd64 として扱う（配信側で既定を当てる・ここは null のまま）。

alter table public.nvmsd_releases
  add column if not exists pkg_format text not null default 'deb',
  add column if not exists pkg_arch   text not null default 'amd64';

alter table public.nvmsd_releases
  drop constraint if exists nvmsd_releases_pkg_format_check,
  add constraint nvmsd_releases_pkg_format_check check (pkg_format in ('deb', 'rpm')),
  drop constraint if exists nvmsd_releases_pkg_arch_check,
  add constraint nvmsd_releases_pkg_arch_check check (pkg_arch in ('amd64', 'arm64'));

-- 版だけの一意 → (版・形式・arch) の一意へ。
alter table public.nvmsd_releases drop constraint if exists nvmsd_releases_version_key;
create unique index if not exists nvmsd_releases_version_format_arch_key
  on public.nvmsd_releases (version, pkg_format, pkg_arch);

comment on column public.nvmsd_releases.pkg_format is
  '配布物の形式（deb=Ubuntu / rpm=Rocky）。拠点の heartbeat の pkg_format と突き合わせて配る。';
comment on column public.nvmsd_releases.pkg_arch is
  '配布物の CPU 種別（amd64 / arm64）。署名が arch を縛るため、拠点の pkg_arch と一致するものだけ配る。';

alter table public.edge_devices
  add column if not exists pkg_format text,
  add column if not exists pkg_arch   text;

alter table public.edge_devices
  drop constraint if exists edge_devices_pkg_format_check,
  add constraint edge_devices_pkg_format_check check (pkg_format is null or pkg_format in ('deb', 'rpm')),
  drop constraint if exists edge_devices_pkg_arch_check,
  add constraint edge_devices_pkg_arch_check check (pkg_arch is null or pkg_arch in ('amd64', 'arm64'));

comment on column public.edge_devices.pkg_format is
  'nvmsd が heartbeat で名乗る配布物の形式（deb / rpm）。null = 名乗り無し（0.1.66 以前）→ deb 扱い。';
comment on column public.edge_devices.pkg_arch is
  'nvmsd が heartbeat で名乗る CPU 種別（amd64 / arm64）。null = 名乗り無し → amd64 扱い。';
