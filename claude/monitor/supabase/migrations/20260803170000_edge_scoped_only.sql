-- エッジ専用スコープ鍵化 Phase B4: エッジごとに「service_role を配らない」を宣言する。
--
-- B3 で全DB/Storageアクセスがスコープトークン経由になった。B4 はその先で、
-- bootstrap が返す `supabase_service_role_key` を止め、device_token が漏れても
-- マスター鍵が取れないようにする（§4.2 の到達点）。
--
-- 【なぜ per-device のフラグにするか】
-- 全台一斉にコード側で止めると、取り残された1台（bootstrap 未到達・旧ビルド）が
-- 無言で死ぬ。実際 2026-08-03 に「bootstrap を一度も叩いていないエッジ」が
-- 1台見つかっている。OTA の desired 版と同じ per-device カナリア方式にして、
-- 1台ずつ確認しながら広げ、問題があれば SQL 1行で即戻せるようにする。
--
-- 【安全装置】bootstrap は「scoped トークンを確かに渡せた時」だけ鍵を省く。
-- provisioning 失敗などでトークンを出せなかった応答では、このフラグが true でも
-- 従来どおり service_role を返す（＝代替手段が無い状態でエッジを丸腰にしない）。
--
-- 【エッジ側からは変更できない】edge_devices の UPDATE は
-- edge_devices_guard_edge_update トリガが自己申告列だけに絞っており、
-- 新しい列は既定で保護対象になる。エッジが自分で false に戻すことはできない。

alter table public.edge_devices
  add column if not exists scoped_only boolean not null default false;

comment on column public.edge_devices.scoped_only is
  'true = bootstrap が supabase_service_role_key を返さない（Phase B4）。'
  '実際に省くのは scoped トークンを渡せた応答のみ。既定 false＝従来どおり。';
