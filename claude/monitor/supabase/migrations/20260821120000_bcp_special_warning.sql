-- BCP 発動条件を「地震＋気象特別警報（警戒レベル5）」に変更する。
--
-- 津波・ミサイル(国民保護)は非対応にした。どちらの電文も JIS 都道府県を
-- 導出できるコードを持たず（津波予報区・3桁は別体系）、対象を絞れないので
-- 「全有効店舗で録画」に倒すしかなかった。北海道の津波警報で沖縄の店舗が
-- 録画を始める形で、店舗数が増えるほど誤発報のほうが大きくなる。
--
-- 代わりに入れる気象特別警報は、区域コード（6桁の府県予報区・細分区域、
-- 7桁の市町村等）の先頭2桁が JIS 都道府県になるよう採番されているため、
-- 地震と同じ都道府県一致で対象を絞れる（実測 4,234 コードで例外 0 件）。
--
-- ⚠ tsunami_enabled / missile_enabled はここでは落とさない。列の DROP は
--   新コードのデプロイ後にしか安全に打てない（旧コードが落ちた列を SELECT
--   すると PostgREST がスキーマエラーを返し、全リクエストが 500 になる。
--   2026-08-06 の scoped_only で実際に起きた）。段階2で別マイグレーションにする。

alter table public.bcp_settings
  add column if not exists special_warning_enabled boolean not null default true;

comment on column public.bcp_settings.special_warning_enabled is
  '気象等の特別警報（警戒レベル5）で録画を起動するか。大雨・土砂災害・高潮・大雪・暴風・暴風雪・波浪の各特別警報を 1 つの条件として扱う。';

comment on column public.bcp_settings.tsunami_enabled is
  '【非対応】2026-08-21 に津波を発動対象から外したため未使用。段階2で削除する。';

comment on column public.bcp_settings.missile_enabled is
  '【非対応】2026-08-21 にミサイル(国民保護)を発動対象から外したため未使用。段階2で削除する。';

-- 気象警報電文を「本文まで見た」印。
--
-- 気象警報（VPWW53）はタイトルが平常時も「気象特別警報・警報・注意報」で、
-- 中の <Kind><Name> を読むまで特別警報の有無が分からない。特別警報でない
-- 電文まで jalert_receipts に入れると受信履歴が雷注意報で埋まる（実測 245通/19時間）。
-- かといって印を残さないと、フィードに載っている 19 時間ぶんを毎分取りに行く。
-- そこで「走査したという事実」だけをここに置く。
create table if not exists public.jalert_scanned_entries (
  entry_id   text primary key,
  scanned_at timestamptz not null default now(),
  had_alert  boolean not null default false
);

comment on table public.jalert_scanned_entries is
  '気象警報電文の走査済みマーク（jalert-poller が使う作業用。7日で自動削除）。had_alert = 特別警報が入っていたか。';

create index if not exists idx_jalert_scanned_entries_scanned_at
  on public.jalert_scanned_entries using btree (scanned_at);

-- ポーラー（service_role）専用。ポリシーを 1 つも置かない＝一般ユーザからは読めない。
alter table public.jalert_scanned_entries enable row level security;
