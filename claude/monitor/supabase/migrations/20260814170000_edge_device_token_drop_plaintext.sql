-- M-5 段階2: 平文の端末トークン列を落とす。
--
-- 段階1（20260814140000）で device_token_hash を追加し、認証 6 箇所を
-- ハッシュ引きへ切り替えた。本番デプロイ dpl_5BF1ZW1e…（2026-08-14 15:42:50 JST）
-- 以降、/api/edge/bootstrap が 15:44:48 / 15:47:51 / 15:49:48 / 15:52:51 の
-- 4 回とも 200 を返していることを実測してから本 migration を用意している。
--
-- ── 適用順序が段階1と逆である理由 ──────────────────────────────────────
-- 列の **追加** は旧コードに無害なのでマージ前に当てられたが、**削除** は
-- 逆で、平文列に insert している旧コードが残っていると PostgREST の
-- スキーマエラー（500）になる。2026-08-06 に scoped_only 列でこれを起こし、
-- 全エッジの bootstrap が同時に落ちた。
--
--   正しい順序: この PR をマージ → Vercel デプロイ完了 → 本 migration を適用
--
-- 注意: デプロイ完了から本 migration 適用までの間、**新規エッジの登録だけ**が
-- 失敗する（コードが device_token を書かなくなる一方、列はまだ NOT NULL）。
-- 既存エッジの認証・heartbeat には影響しない。間を空けずに当てること。

-- 一意制約は列と一緒に落ちる（edge_devices_device_token_key）。
-- ハッシュ側の一意索引は段階1で張ってあるので、重複防止は途切れない。
alter table public.edge_devices drop column if exists device_token;

comment on column public.edge_devices.device_token_hash is
  '端末トークンの SHA-256(hex)。平文は保持しない（払出時のレスポンスが唯一の出口）。'
  '乱数 32 バイトなので総当たり・辞書が成立せず、鍵伸長は不要（enrollment_tokens.token_hash と同方式）。';
