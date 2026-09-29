-- 拠点の https（GVMS_CLOUD_SPEC §10・D-2-20）。
--
-- 管理者が拠点に決めた名前（<ラベル>.sites.genesis-edge.com）と LAN の IP。名前は公開 DNS の
-- A レコード（→ LAN の IP）として置き、設定の配送（GET /api/edge/config の tls）で拠点へ渡す。
-- 拠点はこの名前で Let's Encrypt の証明書を DNS-01 で取り、検証用の TXT を
-- PUT/DELETE /api/edge/tls/txt に頼む（自分の名前の分だけ受ける）。
alter table public.edge_devices
  add column if not exists site_hostname text,
  add column if not exists site_lan_ip   text;

create unique index if not exists edge_devices_site_hostname_key
  on public.edge_devices (site_hostname) where site_hostname is not null;

comment on column public.edge_devices.site_hostname is
  '拠点の https の名前（GVMS_CLOUD_SPEC §10）。NULL = 決めていない（拠点は証明書を自動取得しない）';
comment on column public.edge_devices.site_lan_ip is
  '拠点の LAN の IPv4。site_hostname の A レコードの値';
