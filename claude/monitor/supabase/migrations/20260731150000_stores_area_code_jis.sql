-- BCP エリア照合の是正（2026-07-31 熊本 震度3 不発動の根本原因のデータ側）
--
-- jalert-poller は stores.area_code と JMA XML のコード（都道府県2桁/細分区域/市町村等）
-- を突き合わせるが、既存データは 'JP-01'〜'JP-47'・'JP-PoC' という自前の擬似コードで、
-- 数字の JMA コードと構造的に一致し得なかった（＝地震で 1 店舗も発動しない）。
-- stores.area_code は JIS 市区町村コード（例: 43100 = 熊本市）へ統一する。
-- 照合は都道府県2桁プレフィックスで行うため、下2〜3桁は目安で構わない。

-- 'JP-NN' は都道府県コードと同一採番なので 'NN000' へ機械変換
update public.stores
   set area_code = substring(area_code from 4) || '000'
 where area_code ~ '^JP-[0-9]{2}$';

-- PoC 店舗（熊本市）: 'JP-PoC' → 43100
update public.stores
   set area_code = '43100'
 where area_code = 'JP-PoC';

comment on column public.stores.area_code is
  'JIS 市区町村コード（例: 43100=熊本市）。BCP の J-Alert 照合は都道府県2桁プレフィックスで行う';
