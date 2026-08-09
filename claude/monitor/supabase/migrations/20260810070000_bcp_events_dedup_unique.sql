-- 同一地震・同一店舗で BCP が二重に起動しないよう、DB に強制させる。
--
-- ── なぜ要るのか ──────────────────────────────────────────────────────────
-- jalert-poller は「既に同じ EventID の bcp_events があるか」を **select して
-- から insert** している（processStore）。ところが:
--
--   ・ポーラーは cron で**毎分**呼ばれる（invoke_jalert_poller → net.http_post）
--   ・net.http_post は投げっぱなしで、**前回の実行が終わったかを見ていない**
--   ・1 回の処理は店舗ごとの逐次ループで、各店舗が DB 書き込み＋メール送信を伴う
--     （2026-08-09 の誤発報では 38 店舗が対象になった）
--
-- 処理が 60 秒を超えると次の実行が重なり、**両方が「まだ無い」と判断して
-- 二重に録画指示とメールを出す**。同時視聴上限（20260810050000）と同じ形で、
-- 数えてから入れるまでの隙間が原因。
--
-- ── なぜ一意索引で直すのか ────────────────────────────────────────────────
-- ポーラー全体をリースで直列化する案もあったが、**異常終了でリースを握った
-- まま止まると、期限切れまで発令が遅れる**——災害通知で「重複」と「取りこぼし」
-- なら避けるべきは後者なので、取りこぼす方向の失敗モードを新たに作らない。
--
-- 一意索引は重複を防ぐだけで、発令を落とす方向には働かない。コードが既に
-- 意図していること（processStore の重複判定）を DB に強制させるだけ。
--
-- ⚠ **完全ではない。** 塞がるのは JMA の EventID を持つ電文（地震の大半）。
--   EventID の無い電文は前後 15 分の時間窓によるフォールバック判定のままで、
--   これは一意制約では表現できない。
--
-- ⚠ 本番に既存の重複行があるとこの migration は失敗する。**それは望ましい**
--   （黙って通すより、重複の存在が分かるほうがよい）。確認は:
--     select store_id, alert_type, jma_event_id, count(*)
--       from public.bcp_events
--      where jma_event_id is not null and is_test = false
--      group by 1,2,3 having count(*) > 1;

create unique index if not exists bcp_events_store_alert_event_uniq
  on public.bcp_events (store_id, alert_type, jma_event_id)
  where jma_event_id is not null and is_test = false;

comment on index public.bcp_events_store_alert_event_uniq is
  '同一地震(EventID)・同一店舗・同一種別で BCP を二重起動させない。'
  'ポーラーが毎分呼ばれ多重実行しうるため、select→insert では防げない。'
  'テスト発令(is_test)は対象外。';

-- 既存の bcp_events_jma_event_store_idx（非一意・(jma_event_id, store_id)）は
-- 残す。重複判定の問い合わせは新しい索引でも引けるが、既存の索引に依存した
-- 別の問い合わせが無いことを確かめていないため、この migration では触らない。
