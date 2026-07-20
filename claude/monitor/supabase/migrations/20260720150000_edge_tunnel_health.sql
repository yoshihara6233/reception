-- G1: エッジ「トンネル断」死活監視（heartbeat とは独立の経路）。
--
-- heartbeat（last_seen_at / alerted_at）はエッジ→Supabase のアウトバウンド経路の
-- 死活。cloudflared トンネル（遠隔ライブ/HLS の入口）はエッジ生存中でも単独で
-- 落ちるため、クラウド側から go2rtc へのプローブで別建てに監視する。
--
-- tunnel_down_since : プローブ失敗を最初に観測した時刻（フラップ吸収用）。
-- tunnel_alerted_at : ダウン通知済みマーク（重複通知抑止・復旧通知の判定）。
alter table edge_devices
  add column if not exists tunnel_down_since timestamptz,
  add column if not exists tunnel_alerted_at timestamptz;

comment on column edge_devices.tunnel_down_since is 'トンネル(go2rtc)プローブ失敗の初回観測時刻。成功で NULL に戻る';
comment on column edge_devices.tunnel_alerted_at is 'トンネル断アラート送信済み時刻。復旧通知後 NULL に戻る';
