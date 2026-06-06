-- F76 / Phase 8.3 — bcp_clips に storage_path 列を追加
--
-- 移行戦略
-- ────────
-- PoC では bcp-clips バケットを Public にして clip_url に publicUrl を入れて
-- いた。Phase 8 で Private + 署名 URL に切り替えるため、まずデータモデルを
-- 「URL ではなく storage key」中心に移す。
--
--   旧: clip_url      = 'https://<proj>.supabase.co/storage/v1/object/public/bcp-clips/<key>'
--   新: storage_path  = '<key>'  (例 '<eventId>/<cameraId>/+05_20260606_073012.jpg')
--
-- - clip_url / thumbnail_url は legacy として残す (旧 PoC データの後方互換)。
-- - 新規アップロードは storage_path 必須にしたいが、edge-agent デプロイ前は
--   NULL を許容しておく。Phase 8.3 完了時に NOT NULL 化を別マイグレーションで。
-- - 既存行の storage_path は URL から後方解析できる場合のみ自動補完する。

alter table public.bcp_clips
  add column if not exists storage_path text;

comment on column public.bcp_clips.storage_path is
  'F76: Storage object key inside the bcp-clips bucket (e.g. "<eventId>/<cameraId>/+05_20260606_073012.jpg"). '
  'The signed-URL workflow reads this; clip_url / thumbnail_url remain as legacy fallbacks.';

-- 既存行: clip_url が public URL 形式なら、最後の '/bcp-clips/' 以降を抽出して storage_path に流し込む。
-- (URL がない / フォーマットが違う行は NULL のまま。アプリ側で legacy clip_url にフォールバックする。)
update public.bcp_clips
   set storage_path = substring(clip_url from '/bcp-clips/(.+)$')
 where storage_path is null
   and clip_url is not null
   and clip_url like '%/bcp-clips/%';

-- 後続のフィルタ用 (Service Role での署名 URL 一括生成等で便利)
create index if not exists bcp_clips_storage_path_idx
  on public.bcp_clips (storage_path)
  where storage_path is not null;
