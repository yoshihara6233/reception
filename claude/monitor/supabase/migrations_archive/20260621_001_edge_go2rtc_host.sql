-- エッジ単位の go2rtc 公開オリジン（Cloudflare Tunnel）。
-- 2026-06-21: per-camera の hls_url 設定を撤廃し、エッジに一度設定すれば配下の
--   全 onvif-generic カメラが go2rtc 高画質ライブ対象になる（ストリームは
--   エッジが ONVIF 自動解決で go2rtc に登録、名前は cam_<camera_id>）。
--   例: https://go2rtc-poc.genesis-edge.com
--   monitor は <go2rtc_host>/api/stream.m3u8?src=cam_<id> を認証プロキシ経由で再生。
--   recorder_cameras.hls_url は引き続き「カメラ単位のオリジン上書き」として有効。

ALTER TABLE edge_devices ADD COLUMN IF NOT EXISTS go2rtc_host text;

COMMENT ON COLUMN edge_devices.go2rtc_host IS
  'go2rtc 高画質ライブの公開オリジン(Cloudflare Tunnel)。設定すると配下の '
  'onvif-generic カメラに「高画質(go2rtc)」モードが出る。例: https://go2rtc-poc.genesis-edge.com';
