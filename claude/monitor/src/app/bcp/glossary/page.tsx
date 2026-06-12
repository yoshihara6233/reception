/**
 * /bcp/glossary — BCP 用語説明
 *
 * Jアラート / 自動撮影フロー / 各ステータスなど、BCP ページ群で使う語の
 * 早見表。i18n 対応はナビ / 見出しまで。用語そのものは Japan-specific が
 * 多いので本文は日本語のまま (他言語でも参考情報として有用)。
 */
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'

interface Term { term: string; read?: string; desc: string }
interface Group { title: string; items: Term[] }

const GROUPS: Group[] = [
  {
    title: 'Jアラート関連',
    items: [
      {
        term: 'Jアラート',
        read: 'J-Alert / 全国瞬時警報システム',
        desc: '内閣官房・消防庁が運用する全国瞬時警報システム。地震・津波・ミサイル・大津波警報などを衛星と地上回線で全国の自治体・放送局に直送し、サイレンや自動放送で住民に伝える仕組み。本システムはこの発令イベントを Webhook で受信し、対象店舗の映像保全を自動起動する。',
      },
      {
        term: '気象庁警報',
        read: 'JMA',
        desc: '気象庁が発表する津波・大雨・暴風等の警報。Jアラートに乗ることもあり、地域コードと組み合わせて対象店舗を判定する。',
      },
      {
        term: 'エリアコード',
        read: 'area_code',
        desc: '店舗が属する地域識別子 (例: KANTO / KANSAI / TOHOKU 等)。Jアラートが発表する対象エリアと店舗の area_code を突合してターゲット店舗を絞り込む。',
      },
      {
        term: 'アラート種別',
        read: 'alert_type',
        desc: '津波情報 (tsunami) / 震度情報 (earthquake) / ミサイル情報 (missile) / テスト (test) の 4 種類。種別ごとに撮影時間や対象範囲ロジックを変更可能。',
      },
    ],
  },
  {
    title: 'BCP 自動撮影フロー',
    items: [
      {
        term: 'BCP イベント',
        read: 'bcp_event',
        desc: 'Jアラート受信ごとに作られる 1 件のレコード。対象店舗・アラート種別・発令時刻 (alert_issued_at)・状態 (status) を持つ。',
      },
      {
        term: '記録スナップショット',
        read: 'bcp_snapshot (× 8)',
        desc: '発令時刻を基準に T-5 分 / 発生時 (T+0) / T+5 / +10 / +15 / +20 / +25 / +30 分の 計 8 タイミングで取得する JPEG 静止画。各カメラから並列取得し、Supabase Storage にアップロードされる。動画ではなく JPEG を採用することで、ストレージ容量を大幅に抑えつつ証跡として十分な情報量を確保する。',
      },
      {
        term: 'BCP レポート',
        read: 'bcp_report',
        desc: 'イベント + 8 枚スナップショットを 1 枚の PDF にまとめた成果物。タイトル・災害情報・店舗情報・各時刻のサムネを時系列に並べたタイムラインを含む。保険・行政対応用にメール送付できる。',
      },
      {
        term: 'テスト発令',
        read: 'is_test=true',
        desc: '本番イベントと区別するために、`is_test` フラグが立つテスト用のイベント。実機・実カメラで撮影・PDF 生成までフルテストできるが、保険・行政には送付しない運用とする。',
      },
    ],
  },
  {
    title: 'ステータスのライフサイクル',
    items: [
      { term: 'pending', desc: 'イベント受信直後。これからエッジに撮影開始を指示する状態。' },
      { term: 'recording', desc: '対象店舗のエッジに `start_bcp_capture` を送信済み。映像を保存中。' },
      { term: 'clips_uploaded', desc: '全店舗のクリップが Storage にアップロード完了。あとは PDF 生成待ち。' },
      { term: 'report_generated', desc: 'PDF が生成・保存完了。あとはメール送付待ち / 手動配信。' },
      { term: 'completed', desc: 'メール送付まで完了。終了状態。' },
      { term: 'failed', desc: 'どこかのステップでエラー。詳細はサーバログを参照。' },
    ],
  },
  {
    title: 'エンドポイント / 連携',
    items: [
      {
        term: '/api/bcp-webhook',
        desc: 'Jアラートを受信する Webhook エンドポイント。`Authorization: Bearer <JALERT_WEBHOOK_SECRET>` で認証。POST 本文に alert_type, area_codes, issued_at 等を含める。',
      },
      {
        term: 'start_bcp_capture',
        desc: 'モニターアプリがエッジに送る撮影開始コマンド。エッジは BCP モードに遷移し、対象カメラから 30 分間映像を切り出す。',
      },
      {
        term: 'capture_snapshot',
        desc: 'BCP / 巡回 (SECURITY) で使う即時スナップショット取得コマンド。レポートサムネとして使用。',
      },
    ],
  },
  {
    title: '制約事項 / PoC 段階の既知の限界',
    items: [
      {
        term: 'エッジ単一 BCP 処理制限',
        read: 'bcp: already active, skip — 解消済 (F83 / Phase 8.8)',
        desc: 'PoC では state=`bcp` 中の新規アラートを丸ごとスキップしていた。F83 で per-event worker パターンに置換: 最大 4 件まで BCP イベントを並列実行する。各 worker は独立した Promise で動き、エラーは互いに分離される。state は最初の BCP 起動で `bcp` に切替わり、すべての worker 完了で `idle` に戻る。MAX_BCP=4 を超える同時イベントは拒否ログを残してスキップ (BCP は時限処理のためキューイングは行わない)。',
      },
      {
        term: '過去フレーム取得 / 他ベンダー対応',
        read: 'T-5 など過去オフセット — Frigate (F70) + i-PRO/Uniview (F106) 対応済',
        desc: 'F70 (Frigate) + F106 (i-PRO/Uniview) で対応済。Frigate は clip.mp4 (`/api/<cam>/start/<ts>/end/<ts+1>/clip.mp4`) + ffmpeg `-frames:v 1` で 1 フレーム抽出。i-PRO は `/cgi-bin/snapshot.cgi?ch=N&time=<unix_ts>` で FW v3+ がネイティブ過去フレームを返す (v1/v2 は latest にフォールバック)。Uniview は LAPI に時刻指定エンドポイントが無いため過去オフセット要求でも latest を返す (ONVIF Profile-G 実装は需要次第)。bcp_clips.source カラムで `frigate-recording` / `ipro-historical` / `ipro-latest` / `uniview-latest` / `latest` を区別可能。',
      },
      {
        term: 'BCP クリップ Storage 公開設定',
        read: 'bcp-clips bucket — 解消済 (F76 / Phase 8.3)',
        desc: 'PoC 段階では `bcp-clips` バケットを Public にしていたが、F76 で Private 化 + 署名 URL 運用に移行済。ブラウザ表示は `/api/bcp/clip/<clipId>` プロキシ経由で 60 秒 TTL 署名 URL に redirect、PDF 生成は Service Role で直接 download、ZIP 一括 DL も同じく Service Role で download する。`bcp_clips.storage_path` カラム (F76 マイグレーション) が新しい source of truth で、`clip_url` は legacy 互換のみ残置。',
      },
      {
        term: 'WHIP 動画再生 (VOD)',
        read: 'ffmpeg WHIP muxer — 解消済 (F77 + F79 + F81 + F82 / Phase 8.4-B/8.6/8.7)',
        desc: 'PoC では VOD を ffmpeg → WHIP → LiveKit Ingress 経由で実装したが、Ubuntu 標準 ffmpeg と静的ビルドのいずれにも WHIP muxer が含まれず断念。F77 で「Storage Direct VOD」方式に切替: edge-agent が Frigate clip.mp4 を fetch → ffmpeg 軽量再エンコード (F79: libx264 ultrafast, fragmented MP4 → 標準 MP4, 非単調 DTS 修正) → Supabase Storage `vod-clips` バケットに upload → ブラウザは `/api/vod/<clipId>` で 10分 TTL 署名 URL に redirect → HTML5 ネイティブ `<video controls muted autoplay>` で再生。F81 で同じ (camera, from, to) のリクエストは DB から既存クリップを返す reuse 機能を追加 (Frigate 負荷ゼロ)。F82 で 30 日経過クリップを Vercel Cron 経由で自動削除 (`POST /api/admin/vod/cleanup`, 03:00 JST 日次)。当面 Frigate のみ対応、他ベンダーは Phase 8.5 (F84) で NvrAdapter.exportVodMp4() 経由に統合予定。',
      },
      {
        term: 'テスト発令の PDF 自動生成未対応',
        read: '/api/bcp/test',
        desc: 'テスト発令 (`/bcp/test`) は edge-agent への撮影指示までは行うが、8 枚スナップショット完了後の PDF 自動生成までは未実装。本番アラート (`/api/bcp-webhook`) 経由では bcp_reports 行作成 + PDF 生成 + Storage アップロードまで自動化されているが、テスト経路ではスキップされる。Phase 8 で (a) test API でも同じ PDF 生成フローを実行する、または (b) edge-agent が撮影完了後に PDF 生成 API を呼び出す、のいずれかで対応予定。当面はテスト時のみ手動 PDF 生成が必要。',
      },
    ],
  },
]

export default async function BcpGlossaryPage() {
  const t = await getT()
  const tg = t.bcpGlossary

  return (
    <AdminShell pathname="/bcp/glossary" section="bcp">
      <PageHeader
        title={tg.title}
        crumb={[
          { href: '/bcp',          label: t.breadcrumb.bcp },
          { href: '/bcp/glossary', label: tg.crumb         },
        ]}
      />

      <div className="px-5 py-4">
        <p className="mb-4 max-w-3xl text-xs text-slate-500 dark:text-gedink2">
          {tg.intro}
        </p>

        <div className="grid max-w-3xl gap-5">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h2 className="mb-2 text-sm font-bold text-slate-800 dark:text-gedink">{g.title}</h2>
              <dl className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
                {g.items.map((item, i) => (
                  <div
                    key={item.term}
                    className={'px-4 py-3 ' + (i > 0 ? 'border-t border-slate-100 dark:border-gedline' : '')}
                  >
                    <dt className="flex items-baseline gap-2">
                      <span className="text-[13px] font-bold text-slate-900 dark:text-gedink">{item.term}</span>
                      {item.read && (
                        <span className="font-mono text-[11px] text-slate-400 dark:text-gedink3">
                          {item.read}
                        </span>
                      )}
                    </dt>
                    <dd className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-gedink2">
                      {item.desc}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </AdminShell>
  )
}
