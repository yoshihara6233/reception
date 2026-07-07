-- i-PRO NVR を「レコーダ経由」登録できるよう vendor='i-pro-nvr' を許可。
-- 2026-06-19: カメラ直(onvif-generic) に加え、NVR を recorder として登録し
--   recorder_cameras をチャンネル(CAM)として持つ構成(config②向け)。
--   ライブ=push.cgi(JPEG)・VOD=httpdl.cgi。docs/vendor/ipro-cgi-notes.md。

ALTER TABLE recorders DROP CONSTRAINT IF EXISTS recorders_vendor_check;
ALTER TABLE recorders ADD CONSTRAINT recorders_vendor_check
  CHECK (vendor IN ('ipro','uniview','frigate','onvif-generic','i-pro-nvr'));

COMMENT ON COLUMN recorders.vendor IS
  'ipro / uniview / frigate / onvif-generic(カメラ直) / i-pro-nvr(NVR経由)。'
  'i-pro-nvr は host=NVRのIP、recorder_cameras.channel=CAM。ライブ=push.cgi、VOD=httpdl.cgi。';
