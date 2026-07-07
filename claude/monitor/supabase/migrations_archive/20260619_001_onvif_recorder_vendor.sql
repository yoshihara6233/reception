-- ONVIF generic vendor support (camera-direct endpoints)
-- 2026-06-19 実機スパイク(docs/spike-ipro-nu-result.md)の結論を反映:
--   i-PRO WJ-NU101 配下のカメラは標準 ONVIF/RTSP で成立。NVR は CGI 非互換・
--   ONVIF サーバ非提供。よって「各カメラ = 独立 ONVIF エンドポイント」を
--   recorders 行 (vendor='onvif-generic', host=カメラIP, 認証=カメラ毎) で登録する。
--   recorders は設計上 "NVR / camera-direct endpoint" の両用 (20260519 のコメント参照)。

-- ---------------------------------------------------------------------------
-- recorders: allow vendor = 'onvif-generic'
-- ---------------------------------------------------------------------------
ALTER TABLE recorders DROP CONSTRAINT IF EXISTS recorders_vendor_check;
ALTER TABLE recorders ADD CONSTRAINT recorders_vendor_check
  CHECK (vendor IN ('ipro','uniview','frigate','onvif-generic'));

COMMENT ON COLUMN recorders.vendor IS
  'ipro / uniview / frigate / onvif-generic。onvif-generic は「カメラ直 ONVIF」'
  '(host=カメラIP・1行=1カメラ・認証はカメラ毎)。ライブ/スナップのみ・VOD非対応。';
