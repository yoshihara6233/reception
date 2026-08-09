-- bcp_events に JMA の地震識別子（EventID）を持たせる。
--
-- 1 つの地震に対して気象庁は複数の電文を出す（震度速報 → 震源に関する情報 →
-- 震源・震度に関する情報 → 続報）。電文ごとに Atom の id と updated が異なるため、
-- これまで `alert_type|alert_issued_at|area_code` でグルーピングしていた一覧では
-- **同じ地震が 2 行以上に分かれて**見えていた（例 2026-08-01 02:49 に 18 店舗、
-- 02:52 に 24 店舗＝実際は 1 回の地震）。
--
-- JMA XML の <Head><EventID> は同一地震のすべての電文で共通（実測で確認: 震度速報
-- 2 通・震源に関する情報・震源震度情報の 4 通すべて 20260809025805）。これを保存して
-- グルーピングと重複判定の鍵にする。
--
-- 過去行は NULL のまま（後追いで埋める術がない）。一覧は NULL のときだけ従来の
-- 複合キーへフォールバックするので、既存データの見え方は変わらない。

alter table public.bcp_events
  add column if not exists jma_event_id text;

comment on column public.bcp_events.jma_event_id is
  'JMA 地震火山 XML の <Head><EventID>。同一地震の全電文で共通。一覧のグルーピングと'
  ' 同一地震の重複発動判定に使う。2026-08-09 以前の行と JMA 以外の発令は NULL。';

-- 「この店舗はこの地震で既に発動済みか」を引くための索引。
create index if not exists bcp_events_jma_event_store_idx
  on public.bcp_events (jma_event_id, store_id)
  where jma_event_id is not null;
