-- VOD ソース（NVR）を recorders に付与
-- 2026-06-19: カメラ直 ONVIF はライブ/スナップ用。VOD(録画再生) は i-PRO NVR の
--   httpdl.cgi から取得する（ONVIF Profile-G 不要・docs/vendor/ipro-cgi-notes.md）。
--   onvif-generic のカメラ行に「VODをどのNVRのどのCH(CAM)から取るか」を持たせる。
--   いずれも NULL 可（VOD非対応カメラはNULLのまま）。

ALTER TABLE recorders
  ADD COLUMN IF NOT EXISTS vod_host         text,   -- 例: https://192.168.0.250 (i-PRO NVR)
  ADD COLUMN IF NOT EXISTS vod_username     text,
  ADD COLUMN IF NOT EXISTS vod_password_enc text,   -- 当面 plain: 接頭辞の平文 (Vault化は後)
  ADD COLUMN IF NOT EXISTS vod_channel      int;    -- NVR のカメラ番号 (CAM=)

COMMENT ON COLUMN recorders.vod_host IS
  'VOD取得元 NVR の HTTPS エンドポイント (i-PRO httpdl.cgi)。NULL=VOD非対応。'
  'カメラ直(onvif-generic)はライブ用、VODはこのNVR+vod_channelから取得する。';
