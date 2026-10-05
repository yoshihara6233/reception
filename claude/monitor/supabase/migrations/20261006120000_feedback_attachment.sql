-- 要望の収集 — 画像 1 枚の添付と該当の画面の URL（D-2-21・2026-10-05 発注者の判断）。
--
-- 接続仕様: NVMS/docs/GVMS_CLOUD_SPEC.md §12.2（page_url・attachment の宣言）・§12.6（画像の受け口）
--
-- ① feedback_items に列を足す
--    page_url              該当の画面の場所（`/` か `#` で始まるパスとクエリとハッシュだけ・500 字まで）。
--                          scheme とホスト（拠点の IP や名前）は持たない（API で落とす）。
--    attachment_type       宣言された画像の形式（image/png・image/jpeg・image/webp）
--    attachment_size       宣言された大きさ（バイト・3 MiB まで）
--    attachment_sha256     宣言された中身の SHA-256（小文字 16 進 64 字）
--    attachment_path       受けた画像の置き場（バケット feedback-attachments の `<tenant_id>/<item_id>`）。
--                          受ける前・消した後は null
--    attachment_received_at 受けた時刻。**ここから 365 日で消す**（cron /api/cron/feedback-attachments）
--    attachment_purged_at  1 年を過ぎて消した時刻。消したあと path と received_at は空にし、宣言は残す
--                          （一覧で「画像あり（保存期間を過ぎて消しました）」と出し、送り直しで
--                          受け直さないため）
--
--    宣言（type・size・sha256）と中身（path・received_at）を分けて持つ。現場は本文を先に送り、
--    応答の attachment_needed を見て中身を PUT する（§12.6）。宣言はあるが中身がまだのものは
--    path が null のまま。
--
-- ② 非公開の Storage バケット feedback-attachments（3 MiB・3 形式）。
--    読み書きは service role の API だけ（storage.objects への利用者のポリシーは置かない）。
--    見るときは API が期限つきの URL を作る（運営と、そのテナントの管理者だけ）。

-- ── ① 列 ─────────────────────────────────────────────────────────────
alter table public.feedback_items
  add column if not exists page_url               text,
  add column if not exists attachment_type        text,
  add column if not exists attachment_size        integer,
  add column if not exists attachment_sha256      text,
  add column if not exists attachment_path        text,
  add column if not exists attachment_received_at timestamptz,
  add column if not exists attachment_purged_at   timestamptz;

alter table public.feedback_items
  drop constraint if exists feedback_items_page_url_check,
  drop constraint if exists feedback_items_attachment_type_check,
  drop constraint if exists feedback_items_attachment_size_check,
  drop constraint if exists feedback_items_attachment_sha256_check,
  drop constraint if exists feedback_items_attachment_declared;

alter table public.feedback_items
  add constraint feedback_items_page_url_check
    check (page_url is null or (char_length(page_url) between 1 and 500 and left(page_url, 1) in ('/', '#'))),
  add constraint feedback_items_attachment_type_check
    check (attachment_type is null or attachment_type in ('image/png', 'image/jpeg', 'image/webp')),
  add constraint feedback_items_attachment_size_check
    check (attachment_size is null or attachment_size between 1 and 3145728),
  add constraint feedback_items_attachment_sha256_check
    check (attachment_sha256 is null or attachment_sha256 ~ '^[0-9a-f]{64}$'),
  -- 宣言の 3 つは揃って入るか、揃って空。中身（path）は宣言が無ければ持たない。
  add constraint feedback_items_attachment_declared
    check (
      ((attachment_type is null) = (attachment_size is null) and (attachment_size is null) = (attachment_sha256 is null))
      and (attachment_path is null or attachment_sha256 is not null)
      and ((attachment_path is null) = (attachment_received_at is null))
    );

comment on column public.feedback_items.page_url is
  '該当の画面の場所（GVMS_CLOUD_SPEC §12.2）。`/` か `#` で始まるパスとクエリとハッシュだけ。scheme とホストは持たない。';
comment on column public.feedback_items.attachment_sha256 is
  '宣言された画像の SHA-256（§12.6）。同じ値の中身を受けていれば attachment_needed=false。';
comment on column public.feedback_items.attachment_received_at is
  '画像を受けた時刻。365 日を過ぎたら cron（/api/cron/feedback-attachments）が Storage から消し、path と received_at を空にする。';

-- 1 年で消す片付けの対象を引く（受けた画像だけ）。
create index if not exists feedback_items_attachment_received_idx
  on public.feedback_items (attachment_received_at)
  where attachment_path is not null;

-- ── ② バケット ────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments', 'feedback-attachments', false,
  3145728,  -- 3 MiB（§12.6。受け口でも同じ値で締める）
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- 読み書きはサーバ側 service role のみ（storage.objects へのセッション用ポリシーは作らない）。
