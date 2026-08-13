/**
 * 証跡の取りこぼしの判定。**事実は DB の `evidence_gaps()`、判断はここ。**
 *
 * ── 何を見張るのか ──────────────────────────────────────────────────────
 * 「取得を指示したのに、使える証跡が届いていない」もの。
 *   ・発報の前後スナップ（`alarm_frames`）
 *   ・BCP のクリップ（`bcp_clips`）
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * エッジは `pending_command` を**実行より先にクリア**し、実処理は detached で
 * 走らせる。BCP は最大 30 分かかるので、待つとその間ライブ視聴が止まるためで、
 * これは意図した設計。代償として、拾った直後に落ちると命令はどこにも残らない。
 *
 * 発報側はさらに悪く、クラウドは命令を**書いた時点で**
 * `alarm_events.timeline_dispatched_at` を埋める。リトライ cron は
 * 「`timeline_dispatched_at IS NULL`」だけを再送するので、**消えた命令は
 * 二度と再送されない**。記録上は「送信済み」、実際には 1 枚も撮れていない。
 *
 * ここで見るのは命令の生死ではなく**結果**なので、命令消失だけでなく
 * エッジ停止・NVR 不通・ffmpeg 失敗も同じ網にかかる。
 *
 * ⚠ 命令が届いたかどうかは `edge_command_runs` で切り分ける。ただしあれは
 *   **エッジの新版が配布されてから**しか埋まらないので、ここでは使わない
 *   （配布前は全件「記録なし」になり、原因の誤読を招く）。
 */

/** これを超えたら「たまたま」ではなく仕組みが壊れている、と扱う件数。 */
export const CRITICAL_COUNT = 3

export interface EvidenceFacts {
  checked_at?: string
  days?: number
  grace_minutes?: number
  alarms?: {
    recent?: number
    older?: number
    worst?: { store: string; occurred_at: string }[]
  }
  bcp?: {
    recent?: number
    older?: number
    /** まだ撮る時刻が来ていない clip。正常。誤検知していないことの裏付け。 */
    not_due?: number
    worst?: { store: string; event_id: string; offset_min: number | null; created_at: string }[]
  }
}

export type Severity = 'ok' | 'warn' | 'critical'

export interface EvidenceVerdict {
  severity: Severity
  summary: string
  problems: string[]
}

const jst = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).format(d)
}

export function evaluateEvidenceGaps(facts: EvidenceFacts): EvidenceVerdict {
  // 事実が取れていない＝関数の想定と実際がずれている。**黙って ok にしない。**
  if (!facts.checked_at) {
    return {
      severity: 'critical',
      summary: '証跡の点検結果が取得できませんでした',
      problems: ['evidence_gaps() が想定した形を返していません（migration の適用漏れ？）'],
    }
  }

  const problems: string[] = []
  let severity: Severity = 'ok'
  const raise = (s: Severity) => {
    if (s === 'critical' || (s === 'warn' && severity === 'ok')) severity = s
  }

  const days = facts.days ?? 7
  const alarmRecent = facts.alarms?.recent ?? 0
  const bcpRecent = facts.bcp?.recent ?? 0

  if (alarmRecent > 0) {
    // 1 件なら一時的な不調もありうる。続くなら仕組みが壊れている。
    raise(alarmRecent >= CRITICAL_COUNT ? 'critical' : 'warn')
    problems.push(
      `発報の前後スナップが 1 枚も無いものが ${alarmRecent} 件（直近 ${days} 日）`
      + ' — 記録上は「送信済み」ですが、実際には撮れていません',
    )
    for (const w of (facts.alarms?.worst ?? []).slice(0, 5)) {
      problems.push(`　${w.store}: ${jst(w.occurred_at)} の発報`)
    }
  }

  if (bcpRecent > 0) {
    raise(bcpRecent >= CRITICAL_COUNT ? 'critical' : 'warn')
    problems.push(
      `BCP クリップが取得されないままのものが ${bcpRecent} 件（直近 ${days} 日）`,
    )
    for (const w of (facts.bcp?.worst ?? []).slice(0, 5)) {
      const off = w.offset_min === null || w.offset_min === undefined
        ? '(動画)'
        : `${w.offset_min > 0 ? '+' : ''}${w.offset_min}分`
      problems.push(`　${w.store}: ${jst(w.created_at)} の事象 ${off}`)
    }
  }

  // 過去分は遡って撮り直せないので、severity は上げない。
  // ただし黙って消すと「昔から欠けている」ことに誰も気づかない。
  const older = (facts.alarms?.older ?? 0) + (facts.bcp?.older ?? 0)
  if (older > 0) {
    problems.push(
      `（${days} 日より前にも欠落が ${older} 件あります。撮り直せないため参考値です）`,
    )
  }

  const notDue = facts.bcp?.not_due ?? 0
  const summary = severity === 'ok'
    ? notDue > 0
      // 「撮影待ちが N 件」を出すのは、0 件表示が「検査が動いていない」のか
      // 「対象が無い」のか区別できないため。
      ? `証跡の欠落なし（撮影待ち ${notDue} 件）`
      : '証跡の欠落なし'
    : `証跡が届いていないものが ${alarmRecent + bcpRecent} 件`

  return { severity, summary, problems }
}
