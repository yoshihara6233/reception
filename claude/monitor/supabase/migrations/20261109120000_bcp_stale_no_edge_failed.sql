-- 実際の発令で、エッジの無い拠点の BCP が「進行中」(recording) のまま残っていた行を「失敗」にする。
--
-- 2026-10-06 (ab67c718f) から、取れる先 (エッジ) の無い拠点は発令の時点で failed にしている。
-- それより前の発令 (2026-08-12〜09-28・本番で 116 件) は recording のまま残り、
-- 一覧の「進行中」に出続けていた (2026-11-09 シナリオ試験 2 周目 S-6 で見つけた)。
-- 本番の発令は期限で打ち切らない決まり (lib/bcp/collecting.ts) なので、表示ではなく行を直す。
--
-- 対象は次をすべて満たす行だけ (証跡が 1 枚でもあるもの・エッジのある拠点のものは触らない):
--   - テスト発令ではない
--   - 状態が収集の途中 (pending / recording / clips_uploaded)
--   - 直しの前 (2026-10-07 より前) の発令
--   - その拠点にエッジが 1 台も無い
--   - コマ (bcp_clips) も合成画 (bcp_grid_shots) も 1 行も無い
-- 何度流しても同じ結果になる (2 回目は対象 0 件)。

update public.bcp_events e
   set status = 'failed'
 where coalesce(e.is_test, false) = false
   and e.status in ('pending', 'recording', 'clips_uploaded')
   and e.created_at < timestamptz '2026-10-07 00:00:00+09'
   and not exists (select 1 from public.edge_devices d where d.store_id = e.store_id)
   and not exists (select 1 from public.bcp_clips c where c.event_id = e.id)
   and not exists (select 1 from public.bcp_grid_shots g where g.event_id = e.id);
