-- レコーダのベンダに 'nvms'（自社オンプレ VMS）を追加する。
--
-- NVMS 連携 Phase 1（設計: NVMS/docs/NVMS_RecorderMonitor連携設計.html）。
-- エッジは NVMS の REST API を叩く:
--   ライブ/グリッド : GET /api/v1/cameras/{id}/snapshot（オンデマンド 1fps・初回404あり）
--   録画(VOD/BCP)   : GET /api/v1/recordings/export（結合+トリム済みMP4・SHA-256照合）
--
-- 認証は API キーのみ。username は未使用（'api' を入れる）、password_enc に
-- API キーを既存の暗号化経路のまま保存する。**キーは operator 権限で発行**
-- （範囲エクスポートが operator 以上のため。viewer だと録画だけ 403 になる）。
--
-- カメラの対応付け: recorder_cameras.channel = NVMS のカメラ ID（整数）。
-- クラスタ構成では host に窓口 1 ノードを指定すれば全カメラを取得できる
-- （NVMS は他ノードの媒体を所有ノードへリバースプロキシする）。
--
-- ⚠ この制約は「エッジに実装があるベンダ」だけを通す門番。uniview のときの
--   教訓（実装なしで登録だけできる→押すと失敗）を踏まえ、エッジ側の
--   modes/{grid,live,vod,bcp}.ts に nvms 分岐を入れた同一PRでのみ追加する。

alter table public.recorders drop constraint if exists recorders_vendor_check;

alter table public.recorders add constraint recorders_vendor_check
  check (vendor = any (array['ipro', 'frigate', 'onvif-generic', 'i-pro-nvr', 'nvms']));

comment on column public.recorders.vendor is
  'レコーダ種別。nvms = 自社オンプレ VMS（REST 連携・password_enc に API キー・channel = NVMS カメラID）。';
