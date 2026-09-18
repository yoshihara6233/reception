-- 初期構築（エンロールコード）: nvms 対応 + 短縮コード（NVMS/docs/ENROLLMENT_SPEC.md）。
--
-- ① kind — 'edge'（既存のエッジ箱自己登録・既定）/ 'nvms'（nvmsd アップリンク）。
--    nvms は claim（払い出し）時に vendor='nvms' のレコーダも自動作成する
--    （nvms-sync は事前レコーダを要するため。実体は enroll ルート側で作る）。
-- ② short_code_hash — 短縮コード（QR が主・手入力の控え）の SHA-256。
--    64hex トークン（QR/強い秘密）と短縮コードの**どちらでも同じ行に解決**する。
--    生の短縮コードは発行応答に 1 度だけ返し、DB はハッシュのみ（トークンと同じ扱い）。

alter table public.enrollment_tokens
  add column if not exists kind text not null default 'edge',
  add column if not exists short_code_hash text;

alter table public.enrollment_tokens drop constraint if exists enrollment_tokens_kind_check;
alter table public.enrollment_tokens add constraint enrollment_tokens_kind_check
  check (kind in ('edge', 'nvms'));

comment on column public.enrollment_tokens.kind is
  'edge=エッジ箱自己登録（既定）/ nvms=nvmsd アップリンク（claim 時に nvms レコーダ自動作成）。';
comment on column public.enrollment_tokens.short_code_hash is
  '短縮コードの SHA-256（QR の 64hex トークンと同じ行に解決する手入力控え）。生は保存しない。';

-- 短縮コードでの逆引き（enroll の照合）。
create index if not exists enrollment_tokens_short_code_idx
  on public.enrollment_tokens (short_code_hash) where short_code_hash is not null;
