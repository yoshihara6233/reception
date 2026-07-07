-- I2 fix（/cso 監査で検出）: live_sessions に UPDATE ポリシーが無いため、セッション終了
-- （/api/sessions の end アクション）の UPDATE(ended_at/duration_sec) が RLS で 0 行になり、
-- エラーも出ず黙って失敗していた。
--
-- 影響: ended_at が NULL のまま残り、同時視聴上限カウンタ（ended_at IS NULL を6h窓で計数）が
--   閉じたセッションを最大6時間「稼働中」と誤計数 → 同一ユーザの視聴開閉反復で max_concurrent
--   に到達し 429 で誤ロックアウトする恐れ。あわせてアクセスログの継続時間(duration_sec)も欠落。
--
-- 修正: 自分のセッションのみ更新可（INSERT ポリシー sessions_insert と同じ所有モデル）。
--   他人のセッションは更新不可（越権防止）。super_admin/tenant_admin も終了操作は不要。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'live_sessions' AND policyname = 'sessions_update'
  ) THEN
    CREATE POLICY "sessions_update" ON public.live_sessions
      FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
