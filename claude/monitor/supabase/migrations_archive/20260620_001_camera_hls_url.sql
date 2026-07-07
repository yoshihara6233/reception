-- カメラ単位の go2rtc 高画質ライブ URL。
-- 2026-06-20: onvif-generic(カメラ直)等の H.265 カメラに高画質ライブを与えるため、
--   エッジの go2rtc が H.265→H.264 変換した stream を Cloudflare Tunnel 経由で配信し、
--   monitor がその go2rtc stream.html を iframe 埋め込みで再生する。
--   live_host(recorder単位・Frigate専用) と別に、カメラ単位の URL をここに持つ。
--   例: https://go2rtc-poc.genesis-edge.com/stream.html?src=cam101_h264
--   未設定なら従来どおり(Frigate iframe か 軽量JPEG)。設定は当面 SQL で行う
--   (将来 go2rtc.yaml の DB 由来生成と合わせて管理UI化)。

ALTER TABLE recorder_cameras ADD COLUMN IF NOT EXISTS hls_url text;

COMMENT ON COLUMN recorder_cameras.hls_url IS
  'go2rtc 高画質ライブの stream.html URL(Cloudflare Tunnel経由)。'
  '設定時 monitor のライブ画面に「高画質(go2rtc)」モードを出す。'
  '例: https://go2rtc-poc.genesis-edge.com/stream.html?src=cam101_h264';
