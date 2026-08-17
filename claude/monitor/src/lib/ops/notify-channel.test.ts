import { describe, expect, it } from 'vitest'
import { evaluateNotifyChannel, type NotifyChannelFacts } from './notify-channel'

/**
 * 通知経路の点検。
 *
 * ── 守りたい性質 ────────────────────────────────────────────────────────
 * ① **無効な鍵を検出する**（これが無いと、次の本物の異常まで気づけない）
 * ② **判定できない応答で鳴らさない**（誤報が続く通知は読まれなくなる）
 * ③ 宛先ゼロを見逃さない（異常を検出しても届かない状態）
 *
 * ②が①と同じくらい重要。日次なので誤報は 1 通/日だが、それが続くと
 * 「またこれか」で本物が埋もれる。
 *
 * ── 実測に基づく固定値（2026-08-17）──────────────────────────────────────
 * 無効な鍵 → 400 validation_error "API key is invalid"
 * 鍵未送信 → 401 missing_api_key "Missing API Key"
 * 当初 401 を無効と読む実装にしかけたが、実測は 400 だった。
 * **推測で書いていたら無効な鍵を毎日見逃していた。** ここを固定しておく。
 */

const base: NotifyChannelFacts = {
  apiKeySet: true,
  recipients: 2,
  webhookSet: true,
  probe: { status: 200 },
}

describe('evaluateNotifyChannel — 鍵の有効性', () => {
  it('200 なら正常。何を確かめたのかを要約に出す', () => {
    const v = evaluateNotifyChannel(base)
    expect(v.severity).toBe('ok')
    expect(v.problems).toHaveLength(0)
    // 「問題なし」だけだと、点検が動いていないのか対象が無いのか区別できない。
    expect(v.summary).toContain('宛先 2 件')
  })

  it('★無効な鍵は critical（実測: 400 validation_error）', () => {
    const v = evaluateNotifyChannel({
      ...base,
      probe: { status: 400, name: 'validation_error', message: 'API key is invalid' },
    })
    expect(v.severity).toBe('critical')
    expect(v.problems[0]).toContain('RESEND_API_KEY が無効')
  })

  it('★401 でも「無効」と書いていなければ鳴らさない（送信専用キーを誤報しない）', () => {
    // restricted キーが管理系に何を返すかは実測できていない。
    // 401 を一律 invalid と読むと、送信専用運用に切り替えた日から毎日誤報になる。
    const v = evaluateNotifyChannel({
      ...base,
      probe: { status: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' },
    })
    expect(v.severity).toBe('ok')
    expect(v.problems).toHaveLength(0)
  })

  it('★判定できない応答は記録だけ残して鳴らさない', () => {
    const v = evaluateNotifyChannel({ ...base, probe: { status: 500, name: 'internal_error' } })
    expect(v.severity).toBe('ok')
    expect(v.problems[0]).toContain('判定できませんでした')
  })

  it('★問い合わせ自体ができなくても鳴らさない（Resend 側の一時障害で毎日鳴る）', () => {
    const v = evaluateNotifyChannel({ ...base, probe: null })
    expect(v.severity).toBe('ok')
    expect(v.problems[0]).toContain('未確認')
  })
})

describe('evaluateNotifyChannel — 宛先', () => {
  it('★宛先ゼロ・Webhook も無しは critical（検出しても届かない）', () => {
    const v = evaluateNotifyChannel({ ...base, recipients: 0, webhookSet: false })
    expect(v.severity).toBe('critical')
    expect(v.problems[0]).toContain('通知先がありません')
  })

  it('宛先ゼロでも Webhook があれば warn（届く先は残っている）', () => {
    const v = evaluateNotifyChannel({ ...base, recipients: 0, webhookSet: true })
    expect(v.severity).toBe('warn')
  })

  it('宛先ゼロと無効な鍵が重なったら critical のまま', () => {
    const v = evaluateNotifyChannel({
      ...base,
      recipients: 0,
      webhookSet: true,   // 単体なら warn
      probe: { status: 400, name: 'validation_error', message: 'API key is invalid' },
    })
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(2)
  })
})

describe('evaluateNotifyChannel — 二重報告を避ける', () => {
  it('★鍵未設定は env 台帳の担当なので、ここでは鳴らさない', () => {
    // 同じ障害で 2 行出ると、読む側が別々の問題だと誤読する。
    const v = evaluateNotifyChannel({ ...base, apiKeySet: false, probe: null })
    expect(v.severity).toBe('ok')
    expect(v.problems).toHaveLength(0)
    expect(v.summary).toContain('省略')
  })
})
