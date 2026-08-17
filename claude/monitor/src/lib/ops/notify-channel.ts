/**
 * 通知経路そのものの点検。**事実は Resend への問い合わせ、判断はここ。**
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * 日次点検は「異常があったときだけ」通知する。つまり通知経路が死んでいても、
 * **次に本物の異常が起きるその瞬間まで誰も気づかない**。
 *
 * 2026-08-17 に実際にこの穴に落ちた。8/14 に Resend のメンバーを削除した後、
 * API キーが生きているかを確かめたかったが、点検が毎日 `ok` を返す限り
 * メールは 1 通も出ない。`ops_check_runs` を見ると `alert:` の最後は 8/12 で、
 * **送信経路は 5 日間まったく使われていなかった**。
 * 結局、パスワード再設定を人が手で叩いて確かめるしかなかった。
 *
 * sendEmail() は失敗しても console.error を出して { ok: false } を返すだけで、
 * 呼び出し側の多くは戻り値を捨てている。**沈黙が健康と見分けられない形**が、
 * 監視の通知経路そのものに残っていた。
 *
 * ── 配達ではなく資格情報を見る ──────────────────────────────────────────
 * 毎週テストメールを送る（dead man's switch）方式は取らない。ノイズが増え、
 * 「読まれない通知」を自分で作ることになるため。代わりに**鍵が有効か**を
 * 毎日問う。実際の失敗モード——キーの失効・ローテ漏れ・メンバー削除の巻き添え
 * ——はすべてここに出る。受信側（M365）の配達不良までは見ないが、それは
 * 送信 API の応答では元々分からない。
 *
 * ── 実測（2026-08-17）─────────────────────────────────────────────────
 * GET https://api.resend.com/domains に対する応答:
 *
 *   無効なキー : **400** {"name":"validation_error","message":"API key is invalid"}
 *   キー未送信 : 401 {"name":"missing_api_key","message":"Missing API Key"}
 *
 * 当初 401 を「無効」と読む実装にしかけたが、**実測すると 400 だった**。
 * 推測で書いていたら、無効なキーを毎日「判定不能」として見逃していた。
 *
 * ⚠ 送信専用（restricted）キーがこの管理系エンドポイントに何を返すかは
 *   実測できていない（本番キーは使わない方針のため）。よって
 *   **「無効」と明示された応答だけを critical にする**。判定できない応答は
 *   記録に残すだけで鳴らさない。誤報を出すくらいなら黙るほうを選ぶ——
 *   2 分間隔の cron から誤報を出し続けると本物が埋もれる、と
 *   claim_stale_check_alert で決めた方針に揃えた。
 */

export type Severity = 'ok' | 'warn' | 'critical'

export interface NotifyChannelFacts {
  /** RESEND_API_KEY が設定されているか。 */
  apiKeySet: boolean
  /** ALERT_EMAILS の宛先数。 */
  recipients: number
  /** ALERT_WEBHOOK_URL が設定されているか（メールが死んだときの逃げ道）。 */
  webhookSet: boolean
  /**
   * Resend への問い合わせ結果。問い合わせ自体ができなければ null
   * （ネットワーク断・Resend 側の障害）。
   */
  probe: { status: number; name?: string; message?: string } | null
}

export interface NotifyChannelVerdict {
  severity: Severity
  summary: string
  problems: string[]
}

/** 応答が「キーが無効」と明示しているか。ここだけが critical の根拠。 */
function saysKeyInvalid(p: NonNullable<NotifyChannelFacts['probe']>): boolean {
  if (p.status === 200) return false
  // 実測: 400 / validation_error / "API key is invalid"
  return /api key is invalid/i.test(p.message ?? '')
}

/** 送信専用キーが管理系を弾いただけ、を「有効」と読む。 */
function saysRestricted(p: NonNullable<NotifyChannelFacts['probe']>): boolean {
  return /restricted/i.test(p.name ?? '') || /only send/i.test(p.message ?? '')
}

export function evaluateNotifyChannel(facts: NotifyChannelFacts): NotifyChannelVerdict {
  const problems: string[] = []
  let severity: Severity = 'ok'
  const raise = (s: Severity) => {
    if (s === 'critical' || (s === 'warn' && severity === 'ok')) severity = s
  }

  // キー未設定は env の台帳（env-check.ts・required: true）が既に鳴らす。
  // ここで重ねると同じ障害で 2 行出て、読む側が別々の問題だと誤読する。
  if (!facts.apiKeySet) {
    return {
      severity: 'ok',
      summary: '通知経路の点検を省略（RESEND_API_KEY 未設定・env 側で報告済み）',
      problems: [],
    }
  }

  if (facts.recipients === 0) {
    // 台帳では ALERT_EMAILS を required: false にしている（無くても動くため）。
    // だが日次点検にとっては**宛先ゼロ＝どんな異常も誰にも届かない**。
    raise(facts.webhookSet ? 'warn' : 'critical')
    problems.push(
      facts.webhookSet
        ? 'ALERT_EMAILS が空です（通知は Webhook のみ・メールは誰にも届きません）'
        : 'ALERT_EMAILS が空で Webhook も未設定です — **異常を検出しても通知先がありません**',
    )
  }

  if (facts.probe === null) {
    // 問い合わせできないこと自体では鳴らさない（Resend 側の一時障害で毎日鳴る）。
    problems.push('（Resend に問い合わせできませんでした。鍵の有効性は未確認です）')
  } else if (saysKeyInvalid(facts.probe)) {
    raise('critical')
    problems.push(
      `RESEND_API_KEY が無効です（Resend: ${facts.probe.status} ${facts.probe.name ?? ''}）`
      + ' — 発報通知・死活アラート・パスワード再設定のいずれも送れません',
    )
  } else if (facts.probe.status !== 200 && !saysRestricted(facts.probe)) {
    // 有効とも無効とも読めない応答。記録には残すが鳴らさない。
    problems.push(
      `（Resend の応答を判定できませんでした: ${facts.probe.status}`
      + `${facts.probe.name ? ` ${facts.probe.name}` : ''}。鍵の有効性は未確認です）`,
    )
  }

  const summary = severity === 'ok'
    // 0 件表示が「点検が動いていない」のか「問題が無い」のか区別できないので、
    // 何を確かめたのかを出す（evidence-gaps の「撮影待ち N 件」と同じ理由）。
    ? `通知経路は使用可能（宛先 ${facts.recipients} 件・鍵は有効）`
    : '通知経路に問題があります'

  return { severity, summary, problems }
}

/**
 * Resend に鍵の有効性を問う。**メールは送らない。**
 * 失敗は null（判定不能）で返し、呼び出し側が「鳴らさない」を選べるようにする。
 */
export async function probeResendKey(
  apiKey: string,
  timeoutMs = 5_000,
): Promise<NotifyChannelFacts['probe']> {
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 200) return { status: 200 }
    const body = await res.json().catch(() => ({})) as { name?: string; message?: string }
    return { status: res.status, name: body.name, message: body.message }
  } catch {
    return null
  }
}
