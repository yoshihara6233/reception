/**
 * /security/glossary — 警備機能の用語説明
 *
 * 巡回 / AI 判定 / トリアージなど警備ページ群で使う語の早見表。
 * /infra/glossary や /bcp/glossary と同じスタイルで統一。
 */
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'

interface Term { term: string; read?: string; desc: string }
interface Group { title: string; items: Term[] }

const GROUPS: Group[] = [
  {
    title: 'トリアージ・運用',
    items: [
      {
        term: 'トリアージ',
        read: 'triage',
        desc: '医療現場由来の用語で「優先順位付け」の意。本システムでは AI が検出した finding を「異常 / 要確認 / 正常」に振り分け、人の目で最終判断する一連のフローを指す。',
      },
      {
        term: '巡回',
        read: 'patrol_run',
        desc: '指定間隔ごとに各カメラのスナップショットを取得 → ベースライン画像と比較 → AI 判定までを 1 つの実行単位として記録したもの。`patrol_runs` テーブルに started_at / ended_at / status を持つ。',
      },
      {
        term: '検出 (finding)',
        read: 'patrol_finding',
        desc: '巡回 1 回あたり、対象カメラごとに 0〜1 件作成される判定レコード。`patrol_findings.status` で「anomaly / review / pending / confirmed」が分かる。anomaly + review が人の確認待ち。',
      },
      {
        term: '確認 SLA',
        read: 'review SLA',
        desc: 'finding が出てから人手で確認するまでに守るべき時間 (例: 15 分以内)。SLA 超過は監査ログ / レポートに記録され、運用品質の指標となる。',
      },
      {
        term: '横断キュー',
        read: 'cross-store queue',
        desc: '/security トップに表示される全店舗の未確認 finding を 1 リストにまとめたもの。1 人の警備員が 100 店舗を同時に捌けるようにする UI 設計上の鍵。',
      },
    ],
  },
  {
    title: 'AI 判定ステータス',
    items: [
      {
        term: 'anomaly',
        desc: '「明らかに異常」と AI が判断した状態。要対応キューに最上位で並ぶ。例: 営業時間外の人物検出、本来あるべき物の消失、ドアの開放。',
      },
      {
        term: 'review',
        desc: '「異常かもしれないが微妙」と AI が判断した状態。人の目で最終判断が必要。AI の confidence が中程度の検出はここに入る。',
      },
      {
        term: 'pending',
        desc: 'まだ AI 判定が完了していない状態。スナップショットは撮ったが画像解析が未実行 / 解析中。',
      },
      {
        term: 'confirmed',
        desc: '人が「異常で間違いない」と確認した状態。インシデント作成 / アラート送信のトリガになる。',
      },
      {
        term: 'normal',
        desc: 'AI が「特に問題なし」と判断 (もしくは人が「異常ではない」と確認した) 状態。キューから外れる。',
      },
      {
        term: 'diff_score',
        desc: 'ベースライン画像と現スナップショットのピクセル差分スコア (0.0〜1.0)。閾値 (`sensitivity`) を超えると AI 判定にかける。低い→誤検知が増える / 高い→見逃しが増える。',
      },
    ],
  },
  {
    title: 'AI 比較・プロンプト',
    items: [
      {
        term: 'ベースライン画像',
        read: 'baseline_day_url / baseline_night_url',
        desc: 'カメラの「平常時はこう見えるべき」基準画像。昼用・夜用を別々に登録できる。AI は現スナップショットとベースラインを比較して異常度を出す。',
      },
      {
        term: '比較プロンプト',
        read: 'ai_prompt',
        desc: 'AI に「何を見て判断するか」を伝える自然言語の指示。例: 「扉が閉まっているか」「カウンターに人がいるか」。状態検出のみ記述し、個人特定や顔認識は行わない (プライバシー設計)。',
      },
      {
        term: '感度',
        read: 'sensitivity',
        desc: 'カメラ単位で 0.0〜1.0 で設定する差分閾値。低くするほど些細な差分でも AI 解析にかける (誤検知↑)。デフォルト 0.3。',
      },
      {
        term: 'AI 検証カバレッジ',
        read: 'AI coverage',
        desc: '当日撮影した finding のうち、AI 解析が完了した割合。AI コール失敗・キュー詰まりなどでこの値が下がる。100% を維持するのが運用目標。',
      },
    ],
  },
  {
    title: '巡回スケジュール・設定',
    items: [
      {
        term: '巡回間隔',
        read: 'patrol_interval_min',
        desc: '何分ごとに巡回を回すかの設定。デフォルト 30 分。短くするほど検知が早いが、AI 解析コスト・通信量が増える。',
      },
      {
        term: '巡回時刻',
        read: 'schedule_mode=fixed / patrol_times',
        desc: '「30 分ごと」ではなく「決まった時刻」に巡回したい場合に使う。例: 22:00 / 02:00 / 06:00 (夜間 3 回)。',
      },
      {
        term: 'AI 日次上限',
        read: 'ai_daily_cap',
        desc: '1 日あたりの AI 解析コール上限。コスト制御用。上限に達すると新規 finding は pending のまま AI 解析されず、人手判断のみになる。',
      },
      {
        term: '通知先',
        read: 'notify_emails',
        desc: 'finding が anomaly になった時に通知メールを送る宛先 (複数指定可)。SLA 超過時のエスカレーション先としても使う。',
      },
    ],
  },
  {
    title: 'カメラ・レポート',
    items: [
      {
        term: '巡回参加',
        read: 'patrol_enabled',
        desc: 'カメラ単位で巡回対象に含めるか否か。例: 来客動線のカメラだけ巡回し、駐車場カメラは巡回対象外、といった切り分け。',
      },
      {
        term: '巡回レポート',
        read: 'security_report',
        desc: '日次/週次で生成される PDF レポート。期間中の巡回回数、検知数、対応 SLA 順守率、代表的なスナップショットを含む。',
      },
      {
        term: 'スナップショット',
        read: 'snapshot_url',
        desc: '巡回時にエッジが撮影してアップロードした静止画。Supabase Storage 上にあり、finding にリンク付けされる。',
      },
    ],
  },
]

export default async function SecurityGlossaryPage() {
  const t = await getT()
  const tg = t.securityGlossary

  return (
    <AdminShell pathname="/security/glossary" section="security">
      <PageHeader
        title={tg.title}
        crumb={[
          { href: '/security',          label: t.breadcrumb.security },
          { href: '/security/glossary', label: tg.crumb              },
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
