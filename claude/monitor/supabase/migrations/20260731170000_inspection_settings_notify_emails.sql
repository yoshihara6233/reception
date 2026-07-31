-- 手荷物検査 日次アンマッチレポートの宛先を店舗ごとに明示設定できるようにする。
-- 従来はユーザー管理の担当店舗（admin_users.store_ids）から自動導出しており、
-- BCP(bcp_settings.notify_emails)・巡回(security_settings.notify_emails) と不揃いで、
-- 店舗管理者へ確実に届けられなかった。/admin/baggage の店舗カードで編集する。

alter table public.inspection_settings
  add column if not exists notify_emails text[];

comment on column public.inspection_settings.notify_emails is
  '日次アンマッチレポートの宛先（/admin/baggage で店舗ごとに設定）。null/空のときは当該店舗を担当に持つ admin_users のメールへフォールバック';
