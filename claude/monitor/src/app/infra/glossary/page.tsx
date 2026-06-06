/**
 * /infra/glossary — インフラ管理 用語説明
 *
 * 監視の考え方・機器・チェック種別・インシデント・指標・ヘルス状態の用語を
 * 現場担当者向けに平易に説明する静的ページ。
 */
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'

interface Term { term: string; read?: string; desc: string }
interface Group { title: string; items: Term[] }

const GROUPS: Group[] = [
  {
    title: '監視の考え方',
    items: [
      { term: '受動監視', read: 'passive', desc: 'エッジが自分から送ってくる生存信号（ハートビート）を読むだけの監視。エッジが生きているかは分かるが、その先のレコーダやカメラの状態までは分からない。' },
      { term: '能動チェック', read: 'active', desc: 'クラウドの指示でエッジが実際に機器を叩いて確かめる監視。「レコーダに繋がるか」「カメラが映像を出しているか」を能動的にテストする。受動では見逃す「エッジは生きてるがカメラが死んでいる」を検知できる。' },
      { term: 'ハートビート', read: 'heartbeat', desc: 'エッジが定期的に送る「生きています」信号。最終受信時刻（last_seen_at）が一定時間更新されないと「無応答（オフライン）」と判定する。' },
    ],
  },
  {
    title: '監視対象（機器）',
    items: [
      { term: 'エッジ', read: 'edge', desc: '店舗に置くオンプレ機器。録画装置とクラウドの橋渡しをする。クラウドは店舗内に直接届かないため、能動チェックはエッジが代理で実行する。' },
      { term: 'レコーダ', read: 'recorder / NVR', desc: 'カメラ映像を録画する装置（ipro / uniview など）。死活はエッジからの ping、容量はエッジからの問い合わせで確認する。' },
      { term: 'カメラ', read: 'camera', desc: 'レコーダ配下の各カメラチャンネル。映像が実際に流れているかは probe_camera で確認する。' },
    ],
  },
  {
    title: 'チェック種別',
    items: [
      { term: 'ping_recorder', desc: 'レコーダの host:port へ接続を試み、到達できるかを確認する死活チェック。' },
      { term: 'probe_camera', desc: 'カメラの映像ストリーム（RTSP）に接続して1フレーム取得できるかを確認する。映像が出ているかの実地確認。画像は保存しないので軽い。' },
      { term: 'check_storage', desc: 'レコーダのディスク使用率・録画保持日数を確認。満杯だと録画されないため重要。' },
      { term: '録画連続性 / NTP / 妨害検知', desc: '（将来）指定期間に録画が実在するか、機器の時刻ずれ、カメラの遮蔽・画角ずれなどの高度なチェック。' },
    ],
  },
  {
    title: 'アラート・インシデント',
    items: [
      { term: 'インシデント', read: 'incident', desc: '検知した障害の記録。未対応(open) → 確認済(ack) → 解決(resolved) のライフサイクルで管理する。機器が復帰すると自動で解決になる。' },
      { term: 'デバウンス', read: 'debounce', desc: '一時的なネットワークの揺らぎでアラートを連発しない仕組み。連続N回失敗して初めて発報し、連続M回OKで自動解決する。' },
      { term: '接続障害の疑い', read: 'network outage', desc: 'テナントの多くの拠点が同時に無応答になった場合、個別の機器障害ではなくネットワーク/クラウド側の障害と判断し、1件に集約して表示する（アラート嵐の防止）。' },
      { term: 'メンテ窓', read: 'maintenance window', desc: '計画停止の時間帯。この間はアラートを抑制し、誤った障害通知を出さない。' },
    ],
  },
  {
    title: '指標・レポート',
    items: [
      { term: '稼働率', read: 'uptime %', desc: '対象期間のうち、機器が正常だった割合。日次/週次/月次でレポート化する。' },
      { term: 'MTTR', read: 'mean time to repair', desc: '障害が発生してから復旧するまでの平均時間。運用品質の指標。' },
    ],
  },
]

const HEALTH = [
  { c: '#2F7A4F', label: '正常', desc: 'チェックに合格している' },
  { c: '#B5761A', label: '注意', desc: '閾値に近い・一部に問題の兆候' },
  { c: '#A3332B', label: '障害', desc: '無応答・チェック失敗（要対応）' },
  { c: '#8C8C90', label: '未検証', desc: 'まだ確認していない（P1のレコーダ/カメラ等）' },
  { c: '#2C4A7E', label: 'メンテ', desc: 'メンテ窓中でアラート抑制' },
]

export default async function InfraGlossaryPage() {
  const t = await getT()
  const tg = t.infraGlossary
  return (
    <AdminShell pathname="/infra/glossary" section="infra">
      <PageHeader title={tg.title} crumb={[{ href: '/infra', label: t.breadcrumb.infra }, { href: '/infra/glossary', label: tg.title }]} />

      <div className="px-5 py-4">
        <p className="mb-4 max-w-3xl text-xs text-slate-500 dark:text-gedink2">
          {tg.intro}
        </p>

        {/* ヘルス状態の凡例 */}
        <div className="mb-5 max-w-3xl rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">ヘルス状態（色の意味）</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {HEALTH.map((h) => (
              <div key={h.label} className="flex items-start gap-2.5 text-xs">
                <span className="mt-1 inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ background: h.c }} />
                <div>
                  <span className="font-semibold text-slate-800 dark:text-gedink">{h.label}</span>
                  <span className="ml-2 text-slate-500 dark:text-gedink2">{h.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 用語グループ */}
        <div className="grid max-w-3xl gap-5">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h2 className="mb-2 text-sm font-bold text-slate-800 dark:text-gedink">{g.title}</h2>
              <dl className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
                {g.items.map((t, i) => (
                  <div key={t.term} className={'px-4 py-3 ' + (i > 0 ? 'border-t border-slate-100 dark:border-gedline' : '')}>
                    <dt className="flex items-baseline gap-2">
                      <span className="text-[13px] font-bold text-slate-900 dark:text-gedink">{t.term}</span>
                      {t.read && <span className="font-mono text-[11px] text-slate-400 dark:text-gedink3">{t.read}</span>}
                    </dt>
                    <dd className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-gedink2">{t.desc}</dd>
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
