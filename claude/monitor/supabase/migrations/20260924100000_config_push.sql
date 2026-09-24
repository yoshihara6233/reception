-- 第1弾 A1: 設定・ポリシーの遠隔投入（NVMS/docs/CONFIG_PUSH_SPEC.md）。
--
-- クラウドは「望ましい設定（desired_config）」を固定スキーマの宣言として置くだけ。
-- nvmsd が GET /api/edge/config で取りに来て、自分が解釈できる許可キーだけ適用し、
-- 適用できた版を heartbeat で報告する。冪等（版が変わった時だけ適用）。
--
-- ① recorders.desired_config — 望ましい設定（許可キーのみ・JSON）。null/空=未設定。
-- ② recorders.config_version — 保存ごとに +1。nvmsd は版が変わった時だけ適用。
-- ③ edge_devices.applied_config_version — nvmsd が適用できた版（heartbeat 申告）。
--    アップリンクは 1 エッジ = 1 nvms レコーダなので edge 側に持って join を避ける。
--    desired(config_version) と applied を突き合わせて「反映済み/反映待ち」を出す。

alter table public.recorders
  add column if not exists desired_config  jsonb,
  add column if not exists config_version  int not null default 0;

comment on column public.recorders.desired_config is
  '遠隔投入の望ましい設定（nvms 用・許可キーのみ）。null=未設定。強制は nvmsd 側。';
comment on column public.recorders.config_version is
  '設定の版（保存ごとに +1）。nvmsd は版が変わった時だけ適用する（冪等）。';

alter table public.edge_devices
  add column if not exists applied_config_version int;

comment on column public.edge_devices.applied_config_version is
  'nvmsd が適用できた設定版（heartbeat 申告）。recorders.config_version と一致で反映済み。';
