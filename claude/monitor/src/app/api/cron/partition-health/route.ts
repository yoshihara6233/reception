/**
 * 月次パーティションの残余を毎日見張る cron。
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * パーティションの生成は pg_cron が自動でやっている（毎月25日に翌月・翌々月）。
 * 問題は**止まったときに誰も気づかない**こと:
 *
 *   ・pg_cron のジョブは DB を移行しても引き継がれない。2026-08-01 に BCP の
 *     自動 PDF が沈黙したのがこれで、数日誰も気づかなかった。
 *   ・ジョブが失敗しても cron.job_run_details に溜まるだけで、外には出ない。
 *   ・尽きた月に入った瞬間、live_sessions への INSERT が全店で失敗する
 *     （ライブ視聴の開始時に必ず INSERT される＝**視聴が全面停止**）。
 *
 * 静かに壊れて月替わりの瞬間に全面障害になる形なので、残余そのものを毎日見る。
 * 実際、この検査を入れた初回に `monitor_results_partition` ジョブが
 * migration に載っておらず、建て直した DB には存在しないことが分かった。
 *
 * ── 通知の方針 ──────────────────────────────────────────────────────────
 * 異常なら**毎日鳴らす**（重複抑止の状態を持たない）。エッジ死活のような
 * 頻発するものと違い、これは月に一度あるかどうかで、しかも放置すると必ず
 * 障害になる。「昨日鳴らしたから今日は黙る」が最も困る類なので、
 * 直るまで毎日鳴らすほうを選んだ。日次 cron なので最大でも 1 通/日。
 *
 * 認証: 他の cron と同形（Bearer CRON_SECRET / x-cron-secret）。
 * 通知先: ALERT_EMAILS（カンマ区切り）＋ ALERT_WEBHOOK_URL。両方任意。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail, SECURITY_FROM_ADDRESS } from '@/lib/email/send'
import { sendOpsWebhook } from '@/lib/ops/webhook'
import {
  evaluatePartitionHealth,
  type PartitionHealthFacts,
  type PartitionVerdict,
} from '@/lib/ops/partition-health'
import {
  embedPairsForSql,
  evaluateSchemaInvariants,
  type SchemaInvariantFacts,
} from '@/lib/ops/schema-invariants'
import { missingCriticalEnv } from '@/lib/ops/env-check'
import { DAILY_CHECK, recordCheckRun } from '@/lib/ops/check-runs'
import {
  evaluateNvrClock,
  CRITICAL_OFFSET_SEC,
  STALE_HOURS,
  WARN_OFFSET_SEC,
  type NvrClockFacts,
} from '@/lib/ops/nvr-clock'
import { appBaseUrl } from '@/lib/app-url'

export const dynamic = 'force-dynamic'

function alertHtml(v: PartitionVerdict): string {
  const rows = v.problems.map((p) => `<li>${p}</li>`).join('')
  return `
    <p>本番の日次点検で問題を検出しました。</p>
    <ul>${rows}</ul>
    <p>
      パーティションが尽きると、その表への書き込みは必ず失敗します。
      <b>live_sessions が尽きるとライブ視聴が開始できなくなります。</b>
    </p>
    <p>
      <b>スキーマ</b>の指摘（RLS・ポリシー・SECURITY DEFINER・埋め込みの外部キー）は、
      CI がローカルで見ているのと同じ条件を本番に問うたものです。
      <b>外部キーの欠落は「問い合わせが 400 になるのに 0 件として素通りする」</b>
      形で効きます（2026-08-10 の同時視聴上限の不発動がこれ）。
      直したら <code>supabase db push</code> で本番へ。
    </p>
    <p>
      <b>環境変数</b>の指摘は Vercel → Settings → Environment Variables で設定し、
      再デプロイしてください。値そのものはこの通知には含めていません。
    </p>
    <p>
      <b>NVR 時計</b>の指摘は、<b>その拠点の BCP・発報・検査の映像が、記録された
      時刻とずれている</b>ことを意味します（NVR のタイムラインから切り出すため）。
      現場の NVR に NTP を設定してください。${CRITICAL_OFFSET_SEC} 秒以上のズレは
      証跡として使えない水準です。
    </p>
    <p>まず現状を確認（SQL エディタ）:</p>
    <pre>select jobname, schedule, active from cron.job order by jobname;   -- 6 本あるはず
select name from vault.secrets order by name;                     -- 4 本あるはず</pre>
    <p>パーティションが足りないとき:</p>
    <pre>select public.create_live_sessions_partition(date_trunc('month', now() + interval '1 month')::date);
select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '1 month')::date);</pre>
    <p>cron が欠けているとき — <b>migration を当て直せば全部戻ります</b>:</p>
    <pre>supabase db push</pre>
    <p>
      Vault が欠けているとき — <b>これだけは手で入れ直す必要があります</b>
      （値を migration に書けないため）。手順は
      <code>docs/dr-runbook.md</code> の「バックアップに乗らないもの」を参照。
    </p>
    <p><a href="${appBaseUrl()}/infra">死活監視を開く</a></p>
  `
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const startedAt = Date.now()
  const svc = createSupabaseService()

  /**
   * 記録 → 通知 → 応答をまとめる。**すべての出口をここに通す。**
   *
   * 旧実装は RPC が落ちたとき 500 を返すだけで**通知していなかった**。
   * 点検が壊れたことは誰にも届かず、沈黙は「正常」と見分けが付かない。
   * 2026-08-12 に実際に確かめようとして、Vercel のログを人が掘るしか
   * 手が無いと分かった（2 日かけて潰した形が監視自身にあった）。
   */
  async function finish(v: PartitionVerdict, status: number): Promise<NextResponse> {
    const recorded = await recordCheckRun(
      svc, DAILY_CHECK, v.severity, v.problems, Date.now() - startedAt)

    // 記録できない＝鮮度の判定が効かなくなる。**それ自体を指摘に足す。**
    const problems = recorded
      ? v.problems
      : [...v.problems, '実行記録を残せませんでした（鮮度の見張りが効きません）']
    const severity: PartitionVerdict['severity'] = recorded ? v.severity : 'critical'

    if (severity !== 'ok') {
      console.error('[partition-health]', v.summary, problems)
      const recipients = (process.env.ALERT_EMAILS ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean)
      if (recipients.length) {
        await sendEmail(
          recipients,
          `[Intereco] ${v.summary}`,
          alertHtml({ ...v, problems }),
          undefined,
          SECURITY_FROM_ADDRESS,
        )
      }
      await sendOpsWebhook(`[Intereco] ${v.summary}\n${problems.join('\n')}`)
    }

    return NextResponse.json({
      ok: severity === 'ok',
      severity,
      summary: v.summary,
      problems,
      runway: v.runway,
    }, { status })
  }

  /** 事実が取れないこと自体が異常。**黙って 200 も、黙って 500 も返さない。** */
  const rpcFailed = (fn: string, message: string): PartitionVerdict => ({
    severity: 'critical',
    summary: `日次点検が実行できません（${fn}）`,
    problems: [`${fn}() の呼び出しに失敗しました: ${message}`],
    runway: {},
  })

  const { data, error } = await svc.rpc('partition_health')
  if (error) return finish(rpcFailed('partition_health', error.message), 500)

  const partition = evaluatePartitionHealth((data ?? {}) as PartitionHealthFacts)

  // ── 本番スキーマの不変条件 ───────────────────────────────────────────
  // CI は**ローカルの DB** しか見ていない。本番はダッシュボードの手作業や
  // DR でずれるし、2026-08-10 のようにローカルと本番が同じように壊れて
  // いることもある（live_sessions → stores の外部キーが両方に無く、
  // 同時視聴上限が本番で一度も発動していなかった）。本番自身に毎日聞く。
  const { data: schemaFacts, error: schemaErr } = await svc
    .rpc('schema_invariants', { p_embeds: embedPairsForSql() })
  if (schemaErr) return finish(rpcFailed('schema_invariants', schemaErr.message), 500)
  const schema = evaluateSchemaInvariants((schemaFacts ?? {}) as SchemaInvariantFacts)

  // ── env の必須欠落 ───────────────────────────────────────────────────
  // 台帳（env-check.ts）は /admin のレポートに出しているが、**誰かが見に
  // 行かない限り気づけない**。必須が欠けていれば鳴らす側に回す。
  // 2026-08-09 に本番で無認証だった ONVIF webhook は、コードが正しくても
  // env が欠けていれば起きる類の障害だった。
  const envMissing = missingCriticalEnv().filter((i) => i.required)

  // ── NVR の時計ズレ（2026-08-13 追加）──────────────────────────────────
  // BCP・発報・検査の映像は NVR のタイムラインから切り出すので、NVR の時計
  // ズレはそのまま証跡の時刻ズレになる（実例: NTP 未設定で +3 分）。実測は
  // 30 分毎に動いていたが、**エッジ詳細ページを 1 台ずつ開かないと見えなかった**。
  // 100 拠点では誰も見に行かないので、艦隊全体を日次で鳴らす側に回す。
  const { data: clockFacts, error: clockErr } = await svc
    .rpc('nvr_clock_fleet', {
      p_warn_sec:    WARN_OFFSET_SEC,
      p_stale_hours: STALE_HOURS,
    })
  if (clockErr) return finish(rpcFailed('nvr_clock_fleet', clockErr.message), 500)
  const clock = evaluateNvrClock((clockFacts ?? {}) as NvrClockFacts)

  const problems = [
    ...partition.problems,
    ...schema.problems,
    ...clock.problems,
    ...envMissing.map((i) => `環境変数 ${i.key} が未設定です（${i.purpose}）`),
  ]
  const severity =
    partition.severity === 'critical' || schema.severity === 'critical'
      || clock.severity === 'critical' || envMissing.length > 0
      ? 'critical'
      : partition.severity === 'warn' || schema.severity === 'warn' || clock.severity === 'warn'
        ? 'warn'
        : 'ok'
  const summary = severity === 'ok'
    ? partition.summary
    : (partition.severity !== 'ok' ? partition.summary
      : schema.severity !== 'ok' ? schema.summary
      : envMissing.length > 0
        ? `環境変数の設定漏れ: ${envMissing.map((i) => i.key).join(', ')}`
        : clock.summary)

  return finish({ severity, summary, problems, runway: partition.runway }, 200)
}
