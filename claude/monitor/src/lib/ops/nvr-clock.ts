/**
 * NVR 時計ズレの判定。**事実は DB の `nvr_clock_fleet()`、判断はここ。**
 *
 * ── なぜ見張るのか ──────────────────────────────────────────────────────
 * BCP スナップショット・発報前コマ・検査クリップは、いずれも NVR の
 * タイムラインから切り出す。**NVR の時計ズレは、そのまま証跡の時刻ズレになる**
 * （実例: NTP 未設定で +3 分）。手荷物検査の映像は係争時の証拠になりうるので、
 * 「気づかないまま違う時間帯の映像が証跡になっている」のが最も困る。
 *
 * ── 100 拠点で何が変わるか ──────────────────────────────────────────────
 * 実測は 30 分毎に動いていたが、見えるのは**エッジ詳細ページを 1 台ずつ開いた
 * とき**だけだった。1 台なら回るが、100 台では誰も見に行かない。
 * ここで艦隊全体を 1 つの判定に畳み、日次点検から鳴らす。
 *
 * ⚠ **この段階では補正しない。** まず分布を測る。しきい値や補正方針は、
 *   現場の実際のばらつきを見てから決める（段階1）。
 */

/** ズレの警告しきい値（秒）。UI の警告色と同じ。 */
export const WARN_OFFSET_SEC = 10
/** これを超えると「証跡として使えない」水準。分単位のズレは別格に扱う。 */
export const CRITICAL_OFFSET_SEC = 60
/** 実測が途絶えたとみなす時間。計測は 30 分毎なので 6 時間は十分な猶予。 */
export const STALE_HOURS = 6

export interface NvrClockFacts {
  checked_at?: string
  warn_sec?: number
  stale_hours?: number
  /** 対象エッジ数（retired 除く）。 */
  edges?: number
  /** 一度も測れていない台数。 */
  never_measured?: number
  /** 測ったが古い台数。 */
  stale?: number
  /** しきい値超の台数。 */
  over_threshold?: number
  /** ズレの最大絶対値（秒）。 */
  max_abs_sec?: number
  /** 悪い順の上位。 */
  worst?: { store: string; edge: string; offset_sec: number; abs_sec: number; checked_at: string }[]
}

export type Severity = 'ok' | 'warn' | 'critical'

export interface NvrClockVerdict {
  severity: Severity
  summary: string
  problems: string[]
}

const sign = (n: number): string => (n > 0 ? `+${n}` : `${n}`)

export function evaluateNvrClock(facts: NvrClockFacts): NvrClockVerdict {
  const problems: string[] = []
  let severity: Severity = 'ok'
  const raise = (s: Severity) => {
    if (s === 'critical' || (s === 'warn' && severity === 'ok')) severity = s
  }

  // 事実が取れていない＝関数の想定と実際がずれている。**黙って ok にしない。**
  if (!facts.checked_at) {
    return {
      severity: 'critical',
      summary: 'NVR 時計の点検結果が取得できませんでした',
      problems: ['nvr_clock_fleet() が想定した形を返していません（migration の適用漏れ？）'],
    }
  }

  const edges = facts.edges ?? 0
  if (edges === 0) {
    // エッジが 1 台も無い環境（ローカル・新規テナント）。異常ではない。
    return { severity: 'ok', summary: 'NVR 時計: 対象エッジなし', problems: [] }
  }

  const worst = facts.worst ?? []
  const over = facts.over_threshold ?? 0
  const maxAbs = facts.max_abs_sec ?? 0

  if (over > 0) {
    // 分単位のズレは証跡として使えない水準。秒単位とは扱いを分ける。
    raise(maxAbs >= CRITICAL_OFFSET_SEC ? 'critical' : 'warn')
    problems.push(
      `NVR 時計がずれている拠点が ${over} / ${edges} 台（最大 ${maxAbs} 秒）`
      + ' — その拠点の BCP・発報・検査の映像は、記録された時刻とずれています',
    )
    // 100 拠点ぶん並べるとメールが読めなくなり、結果として誰も読まなくなる。
    // 上位だけ挙げて、残りは件数で示す。
    //
    // ⚠ 残り件数は **表示した数** から引く。DB 側の `worst` は上限付き
    //   （既定 20 件）なので、そちらの長さから引くと合わない
    //   （37 台中 10 台を表示して「他 17 台」と書く誤りをテストが拾った）。
    const shown = worst.slice(0, 10)
    for (const w of shown) {
      problems.push(`　${w.store} / ${w.edge}: ${sign(w.offset_sec)} 秒`)
    }
    const rest = over - shown.length
    if (rest > 0) problems.push(`　（他 ${rest} 台）`)
  }

  const never = facts.never_measured ?? 0
  if (never > 0) {
    // 測れない＝NVR に届いていないか、エッジが古い版。ズレの有無すら分からない。
    raise('warn')
    problems.push(
      `NVR 時計を一度も測れていない拠点が ${never} / ${edges} 台`
      + ' — ズレの有無が分かりません（NVR への到達性、またはエッジの版を確認）',
    )
  }

  const stale = facts.stale ?? 0
  if (stale > 0) {
    // 計測は 30 分毎。止まっている＝エッジか NVR のどちらかが不調。
    raise('warn')
    problems.push(
      `NVR 時計の実測が ${facts.stale_hours ?? STALE_HOURS} 時間以上止まっている拠点が ${stale} / ${edges} 台`,
    )
  }

  const summary = severity === 'ok'
    ? `NVR 時計正常（${edges} 台・最大 ${maxAbs} 秒）`
    : severity === 'critical'
      ? `NVR 時計が分単位でずれています（最大 ${maxAbs} 秒 / ${over} 台）`
      : `NVR 時計の要確認が ${over + never + stale} 台`

  return { severity, summary, problems }
}
