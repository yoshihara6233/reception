-- OS の既知の脆弱性の申告（G・VMS-Cloud 接続仕様 §13・NVMS/docs/GVMS_CLOUD_SPEC.md・WBS F-7）。
--
-- 拠点の各サーバが照合表と OS の部品の版を比べた結果を heartbeat の os_vuln で受け、
-- 拠点稼働の一覧（/admin/fleet）で「OS の更新が要る拠点」を運営とパートナーが追えるようにする。
-- 一覧で絞り込むため、緊急・定期保守の合計は別の列にも持つ。
-- os_vuln を名乗らない拠点は null・0 に戻す（版を戻した拠点に古い申告を出し続けない）。
-- 行の見え方は edge_devices の今のポリシーのまま（パートナーは担当の拠点だけ）。

alter table public.edge_devices
  add column if not exists os_vuln             jsonb,
  add column if not exists os_vuln_urgent      int not null default 0,
  add column if not exists os_vuln_routine     int not null default 0,
  add column if not exists os_vuln_reported_at timestamptz;

comment on column public.edge_devices.os_vuln is
  'OS の既知の脆弱性の照合の結果（heartbeat.os_vuln・§13）。サーバごとのカーネル・件数・CVE。null=申告なし。';
comment on column public.edge_devices.os_vuln_urgent is
  '緊急の件数の全サーバの合計（§13）。0=無い・申告なし。';
comment on column public.edge_devices.os_vuln_routine is
  '定期保守の件数の全サーバの合計（§13）。';
comment on column public.edge_devices.os_vuln_reported_at is
  'os_vuln を最後に受けた時刻。';
