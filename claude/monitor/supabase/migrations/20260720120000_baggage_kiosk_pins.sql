-- 手荷物検査 iPadキオスクの店舗別6桁PINログイン
--
-- iPad を admin_users セッションに常設ログインさせる代わりに、店舗ごとの6桁PINで
-- 「キオスク専用・店舗限定」のセッション（署名cookie）を発行できるようにする。
-- PIN は scrypt ハッシュで保存し、平文は保持しない。オンライン総当り対策として
-- 失敗回数とロック期限を持つ（アプリ側で 5回失敗→15分ロックを判定）。
--
-- 読み書きはすべてサーバ側 service role で行う（このテーブルにセッション用 RLS
-- ポリシーは作らない＝deny）。PIN設定/照合の認可はアプリのガード（requireBaggageAccess・
-- pin-login レート制御）で担保する。

CREATE TABLE IF NOT EXISTS public.baggage_kiosk_pins (
  store_id        UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL,
  pin_hash        TEXT NOT NULL,            -- scrypt: base64(salt)$base64(dk)
  failed_attempts INT  NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  updated_by      UUID,                     -- 設定した admin_users.id（監査用）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.baggage_kiosk_pins IS
  '手荷物検査 iPadキオスクの店舗別PIN（scryptハッシュ）。読み書きは service role のみ。';

-- RLS を有効化するがセッション用ポリシーは作らない（= service role 以外は全 deny）。
ALTER TABLE public.baggage_kiosk_pins ENABLE ROW LEVEL SECURITY;

-- 失敗回数の加算＋ロックを1文で原子的に行う（read-modify-write のロストアップデート
-- =総当り防御の無効化を防ぐ）。5回で15分ロックし失敗カウンタを0に戻す。
-- しきい値はアプリ定数 MAX_PIN_ATTEMPTS(5) / LOCK_MINUTES(15) と一致させること。
CREATE OR REPLACE FUNCTION public.baggage_kiosk_pin_fail(p_store UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.baggage_kiosk_pins
     SET failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
         locked_until    = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
   WHERE store_id = p_store
   RETURNING locked_until;
$$;

-- サーバ（service role）専用。anon/authenticated からの直接実行は不可にする。
REVOKE ALL ON FUNCTION public.baggage_kiosk_pin_fail(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.baggage_kiosk_pin_fail(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.baggage_kiosk_pin_fail(UUID) TO service_role;
