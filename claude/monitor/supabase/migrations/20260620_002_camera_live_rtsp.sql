-- カメラの go2rtc ライブ用 RTSP ソース。
-- 2026-06-20: エッジが go2rtc ストリームを DB から自動登録するための入力。
--   手動 go2rtc.yaml 編集を撤廃し、多店舗・多カメラにスケールさせる。
--   値は以下のどちらでも可:
--     - 完全URL: rtsp://192.168.0.101:554/MediaInput/h265 (認証はエッジが recorders の
--       username/password_enc から注入。URLに userinfo があればそれを使用)
--     - パスのみ: MediaInput/h265 (エッジが rtsp://<host>:<rtsp_port>/<path> を組み立て)
--   null の場合、そのカメラは go2rtc 高画質ライブ対象外(将来 ONVIF 自動解決で補完予定)。
--   コーデック(H.264/H.265)はエッジが ffprobe で判定し、H.265 のみ VAAPI で H.264 変換する。

ALTER TABLE recorder_cameras ADD COLUMN IF NOT EXISTS live_rtsp text;

COMMENT ON COLUMN recorder_cameras.live_rtsp IS
  'go2rtc 高画質ライブの RTSP ソース(完全URL or パスのみ)。エッジが go2rtc に '
  'stream "cam_<camera_id>" として自動登録する。null=go2rtc対象外。';
