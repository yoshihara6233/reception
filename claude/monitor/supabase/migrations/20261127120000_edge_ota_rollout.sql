-- 順送りの自動更新の進み具合の申告（G・VMS-Cloud 接続仕様 §15・NVMS/docs/GVMS_CLOUD_SPEC.md・WBS E-4-8）。
--
-- サーバが 2 台以上の拠点（G・VMS 1.0.0 以降・ota_rollout を名乗る）は、クラウドからの更新を
-- 1 台ずつ空にしてから当てる。その進み具合（版・段・扱っているサーバ・台数・止めた理由）を
-- heartbeat の ota_rollout で受け、拠点の詳細に出す。作業が無いとき・名乗らない拠点は null に戻す。
-- 行の見え方は edge_devices の今のポリシーのまま。

alter table public.edge_devices
  add column if not exists ota_rollout             jsonb,
  add column if not exists ota_rollout_reported_at timestamptz;

comment on column public.edge_devices.ota_rollout is
  '順送りの自動更新の進み具合（heartbeat.ota_rollout・§15）。null=作業なし・申告なし。';
comment on column public.edge_devices.ota_rollout_reported_at is
  'ota_rollout を最後に受けた時刻。';
