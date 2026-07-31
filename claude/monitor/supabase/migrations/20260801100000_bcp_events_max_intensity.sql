-- BCP イベントに実際の最大震度を持たせる（/bcp 一覧・レポート PDF に表示）。
-- これまで震度は jalert_receipts にのみ記録され、イベント側から辿れなかった。
-- 以後は jalert-poller がイベント作成時に書き込む。既存行は受信ログから補完する。

alter table public.bcp_events
  add column if not exists max_intensity text;

comment on column public.bcp_events.max_intensity is
  'JMA MaxInt 生値（1〜4, 5-, 5+, 6-, 6+, 7）。地震以外・不明は null';

update public.bcp_events e
   set max_intensity = r.max_intensity
  from public.jalert_receipts r
 where e.alert_source = r.alert_source
   and e.max_intensity is null;
