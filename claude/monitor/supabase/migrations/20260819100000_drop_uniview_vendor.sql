-- Uniview を選択可能なベンダから外す。
--
-- ── なぜ消すのか ────────────────────────────────────────────────────────
-- 登録はできるのに、映像系がほとんど動かない状態だった。
--
--   グリッド : snapshotUrl() が Frigate 専用のため null → セルが黒のまま
--   ライブ   : `live: vendor "uniview" has no snapshot source` を throw
--   録画再生 : **UI は録画ボタンを出す**（VOD_VENDORS に uniview が入っていた）
--              のに、エッジは `VOD unsupported: vendor=uniview` で弾く
--
-- 宣言（クラウド）と実装（エッジ）が逆を向いており、顧客が録画ボタンを
-- 押して初めて失敗が分かる形だった。Dahua は DB 制約で弾かれて登録すら
-- できない＝安全側に倒れているが、Uniview は危険側に倒れていた。
--
-- 対応方針として「Uniview は対応しない」と決めたため、選べる状態そのものを
-- なくす。対応しないベンダが選択肢に残っていること自体が不具合と考える。
--
-- ── 適用前に確認したこと ────────────────────────────────────────────────
-- 本番の recorders は i-pro-nvr 1 件 / onvif-generic 2 件のみで、
-- **uniview は 0 件**。1 件でもあれば制約違反で落ちるため、先に実測した。
--
-- 'ipro'（レガシーのカメラ直）も同じくグリッド/ライブが動かず 0 件だが、
-- BCP は snapshot.cgi の ?time= で過去フレームまで取得できる実装があり
-- 事情が異なるため、本 migration の対象には含めない（別途判断する）。

alter table public.recorders drop constraint if exists recorders_vendor_check;

alter table public.recorders add constraint recorders_vendor_check
  check (vendor = any (array['ipro', 'frigate', 'onvif-generic', 'i-pro-nvr']));

comment on column public.recorders.vendor is
  'レコーダの機種系統。対応している値のみ。Uniview は実装が伴わないため 2026-08-19 に削除した。';
