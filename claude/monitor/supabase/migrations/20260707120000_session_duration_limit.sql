-- R1: セッション時間上限（1視聴セッションの最大継続時間）をテナント毎に設定可能にする。
--
-- 既存の session_limits は同時視聴数(max_concurrent)のみ強制していた。ここに
-- 「1回のライブ/VOD 視聴セッションの最大継続分数」を追加する。既定 120 分。
-- テナント行が無い場合はアプリ側で既定 120 分にフォールバックする（この列の DEFAULT と一致）。
--
-- 対象は帯域コストの高い live / vod のみ（grid=スナップ合成は安価なので上限対象外）。
-- 強制はクライアント（残時間UI＋到達時に視聴停止）＋セッション終了記録で行う。

ALTER TABLE public.session_limits
  ADD COLUMN IF NOT EXISTS max_session_min integer NOT NULL DEFAULT 120;

COMMENT ON COLUMN public.session_limits.max_session_min IS
  '1視聴セッション(live/vod)の最大継続時間(分)。既定120。テナント毎に上書き可。';

-- 値域ガード（1分〜24時間）。異常値でのロックアウト/無制限化を防ぐ。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_limits_max_session_min_chk'
  ) THEN
    ALTER TABLE public.session_limits
      ADD CONSTRAINT session_limits_max_session_min_chk
      CHECK (max_session_min BETWEEN 1 AND 1440);
  END IF;
END $$;
