-- NVR 機種マスタを i-PRO WJ-NU101K だけにする (2026-09-29 利用者の判断)。
--
-- VMS を自前 (G・VMS) にしたため、Frigate・Hanwha・Hikvision・Synology と、i-PRO の
-- ほかの機種は画面から外す。対応する接続アダプタのコードは残す (要望があれば戻す)。
-- 拠点 (stores.nvr_model) が参照している機種は消さない (EOL/EOS の同期に使うため)。
delete from public.nvr_models
 where model_number <> 'WJ-NU101K'
   and model_number not in (select nvr_model from public.stores where nvr_model is not null);
