-- F80 / Phase 8 — recorders に外部公開 live_host を追加
--
-- 目的
--   ブラウザが iframe で開く NVR ライブ UI の URL ホストを保存する。
--   既存の `recorders.host` は edge-agent から見たホスト (多くは 127.0.0.1)
--   なのでブラウザでは使えない。LAN 内の実 IP を別途持つ。
--
-- 例
--   recorders.host        = '127.0.0.1'       ← edge-agent → Frigate (同 PC)
--   recorders.live_host   = '192.168.0.100:5000'  ← ブラウザ → Frigate (LAN)
--
-- URL 構成
--   Frigate: http://<live_host>/cameras/<frigate_camera>
--   将来:    機種ごとに URL パターン定義が必要なら live_url_pattern 列を別途追加
--
-- 制約
--   - NULL 可: 値が無ければライブ iframe モード不可 → JPEG ポーリング自動継続
--   - public bucket と同じく Mixed Content の懸念あり (HTTPS 本番では別途解決)

alter table public.recorders
  add column if not exists live_host text;

comment on column public.recorders.live_host is
  'F80: External (LAN) host:port that the BROWSER uses to reach this NVR''s '
  'live UI iframe (e.g. "192.168.0.100:5000" for Frigate). Different from '
  '`host`, which is the edge-agent''s perspective (often 127.0.0.1). '
  'NULL = no iframe mode, browser falls back to JPEG polling (BCP-friendly).';

-- PoC Beelink Frigate 用に live_host を投入
update public.recorders
   set live_host = '192.168.0.100:5000'
 where vendor = 'frigate'
   and host in ('127.0.0.1', 'localhost')
   and live_host is null;
