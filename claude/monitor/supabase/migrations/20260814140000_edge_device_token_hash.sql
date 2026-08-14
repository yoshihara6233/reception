-- エッジ端末トークンをハッシュで保管する（脆弱性検査 M-5・段階1/2）。
--
-- ── なぜ要るか ────────────────────────────────────────────────────────────
-- スキーマ上の認証用の秘密を横並びにすると、**平文はこれ 1 本だけ**だった:
--   baggage_kiosk_pins.pin_hash        … scrypt
--   enrollment_tokens.token_hash       … SHA-256（同じ用途・隣の表）
--   recorders.password_enc ほか        … Vault 暗号化
--   edge_devices.auth_password_enc     … 暗号化
--   edge_devices.device_token          … **平文** ★
--
-- この値は `/api/edge/bootstrap`（スコープトークンを発行）と
-- `/api/alarms/ingest` ほか計 6 本の受け口の認証子。DB を読める経路——
-- super_admin の管理画面・バックアップ・ダンプの流出——が 1 つでもあれば、
-- **任意のエッジになりすませる**（偽の発報を上げ、その店舗にスコープされた
-- トークンを受け取れる）。
--
-- ── なぜ 2 段階に分けるか ────────────────────────────────────────────────
-- **列を落とすのは、新しいコードが本番で動いてから。** 先に落とすと、
-- 入れ替わり前の古いコードが `.eq('device_token', ...)` で消えた列を引き、
-- PostgREST のスキーマエラー＝ 500 になる。2026-08-06 に `scoped_only` 列で
-- 同じことが起き、全エッジの bootstrap が同時に落ちている。
--
-- しかも今日 B4 を完走して service_role をエッジから消したため、
-- **bootstrap が壊れると代替経路が無い**（スコープトークンの期限 1 時間で停止）。
-- 段階1（本 migration・列の追加）→ コード切替 → 実機確認 → 段階2（平文列を落とす）。
--
-- ⚠ 段階1では `device_token`（平文）を**残す**。発行側は当面その両方を書く。
--
-- ── 取りこぼしを黙って通さない ──────────────────────────────────────────
-- backfill のあとに NOT NULL を掛ける。1 行でも埋まっていなければ
-- **この migration が落ちる**。「一部だけ移行できた」状態で先へ進まない。
alter table public.edge_devices
  add column if not exists device_token_hash text;

comment on column public.edge_devices.device_token_hash is
  'device_token の SHA-256（hex）。認証はこの列で引く。enrollment_tokens.token_hash と同方式。';

-- 既存行を埋める（PG 組込みの sha256。拡張不要）。
update public.edge_devices
   set device_token_hash = encode(sha256(device_token::bytea), 'hex')
 where device_token_hash is null
   and device_token is not null;

-- 埋め残しがあればここで落ちる。
alter table public.edge_devices
  alter column device_token_hash set not null;

-- 認証の引き当てに使うので一意かつ索引付き。
create unique index if not exists edge_devices_device_token_hash_key
  on public.edge_devices (device_token_hash);
