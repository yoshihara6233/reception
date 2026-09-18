-- 保守自動化②: nvmsd OTA の「自動／現地」モード（OTA_SPEC 付録A・2026-09-18 発注者決定）。
--
-- 基準5（更新で録画が約 5 秒欠ける）を仕様として受け入れたうえで、運用を
-- 拠点規模で切り分ける:
--   - 現地（onsite・既定）: クラウドからは push しない。画面から現地更新（欠損なし）。
--     複数台の拠点は現地に倒す。
--   - 自動（auto）: agent-update でクラウドから配信。1 台の拠点はそもそも
--     欠損なしの更新ができない（預け先が無い）ため自動でよい。
--
-- このモードは **nvmsd アップリンクの agent-update 配信にのみ効く**。
-- エッジ箱の bootstrap OTA（desired_agent_version 経由）はこの列を見ない。
-- 「現地に倒して損なのは手間、自動に倒して損なのは録画」なので既定は現地。

alter table public.edge_devices
  add column if not exists ota_mode text not null default 'onsite';

alter table public.edge_devices drop constraint if exists edge_devices_ota_mode_check;
alter table public.edge_devices add constraint edge_devices_ota_mode_check
  check (ota_mode in ('onsite', 'auto'));

comment on column public.edge_devices.ota_mode is
  'nvmsd OTA の配信モード: onsite=クラウドから配信しない（既定・画面から現地更新）/ auto=agent-update で配信。エッジ箱 bootstrap OTA は参照しない。';
