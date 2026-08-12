import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBcpCaptureCommand } from '../../../supabase/functions/jalert-poller/flow'

/**
 * 自動取得コマンドの T+0 契約。
 *
 * ── 何が起きたか ────────────────────────────────────────────────────────
 * エッジは `clipFrom` を **発令時刻（T+0）** として各オフセットの取得時刻を
 * 計算する（claude/edge-agent/src/modes/bcp.ts）:
 *
 *     const alertIssuedMs = new Date(clipFrom).getTime()
 *     const targetMs      = alertIssuedMs + offsetMin * 60_000
 *
 * ここに旧 VOD 方式の「発令 − pre分」を渡すと、**全 8 コマが pre 分だけ
 * 過去にずれる**。タイルのラベル（発令時刻から計算）と実画像が一致せず、
 * 現場には「時刻がずれている」という形で見える。**NTP とは無関係。**
 *
 * 2026-07-13 にこの是正を入れたが、当てたのは /api/bcp/test と
 * /api/bcp/[id]/retrieve の 2 経路だけで、**J-Alert ポーラーが取り残された**。
 * テスト発令では正しく見えるため、実発令だけが 3 分ずれ続けた
 * （2026-08-13 に震度情報の証跡で再発見。pre_minutes 既定 3 分ぶんちょうど）。
 *
 * 「同じ修正を全経路に当てたか」は人の注意では担保できない。下の棚卸しが
 * **発令経路を数え上げて**、1 つでも外れたら落ちる。
 */

describe('buildBcpCaptureCommand', () => {
  const base = {
    requestId:     'req-1',
    eventId:       'ev-1',
    clips:         [{ clipId: 'c1', cameraId: 'cam1' }],
    alertIssuedAt: '2026-08-13T06:23:02.000Z',
    clipTo:        '2026-08-13T06:28:02.000Z',
  }

  it('★clipFrom は発令時刻そのもの（録画区間の開始ではない）', () => {
    expect(buildBcpCaptureCommand(base).clipFrom).toBe(base.alertIssuedAt)
  })

  it('★「発令 − pre分」を渡す余地が無い（引数名が alertIssuedAt）', () => {
    // 旧実装は `clipFrom`（= 発令 − pre分）という変数をそのまま渡していた。
    // 引数名を alertIssuedAt にしてあるので、同じ取り違えは書きにくい。
    const preShifted = '2026-08-13T06:20:02.000Z'   // 発令 − 3分
    const cmd = buildBcpCaptureCommand({ ...base, alertIssuedAt: base.alertIssuedAt })
    expect(cmd.clipFrom).not.toBe(preShifted)
  })

  it('エッジ側の計算と突き合わせると、ラベルどおりの時刻になる', () => {
    // エッジ: targetMs = new Date(clipFrom).getTime() + offsetMin * 60_000
    const cmd = buildBcpCaptureCommand({ ...base, offsets: [-5, 0, 5, 30] })
    const anchor = new Date(cmd.clipFrom).getTime()
    const at = (m: number) => new Date(anchor + m * 60_000).toISOString()
    expect(at(-5)).toBe('2026-08-13T06:18:02.000Z')   // ラベル「5分前」
    expect(at(0)).toBe('2026-08-13T06:23:02.000Z')    // ラベル「発生時」
    expect(at(30)).toBe('2026-08-13T06:53:02.000Z')   // ラベル「30分後」
  })

  it('offsets 未指定なら既定 [-5, 5]', () => {
    expect(buildBcpCaptureCommand(base).offsets).toEqual([-5, 5])
    expect(buildBcpCaptureCommand({ ...base, offsets: null }).offsets).toEqual([-5, 5])
  })

  it('指定された offsets はそのまま通す', () => {
    const offsets = [-5, 0, 5, 10, 15, 20, 25, 30]
    expect(buildBcpCaptureCommand({ ...base, offsets }).offsets).toEqual(offsets)
  })

  it('action と各項目がエッジの型どおり', () => {
    const cmd = buildBcpCaptureCommand(base)
    expect(cmd.action).toBe('start_bcp_capture')
    expect(cmd.request_id).toBe('req-1')
    expect(cmd.eventId).toBe('ev-1')
    expect(cmd.clips).toEqual([{ clipId: 'c1', cameraId: 'cam1' }])
    expect(cmd.clipTo).toBe(base.clipTo)
  })
})

/**
 * 発令経路の棚卸し。**`start_bcp_capture` を発行する箇所を数え上げる。**
 *
 * 今回の不具合は「3 経路のうち 2 経路だけ直した」形だった。同じ取り残しを
 * 二度と起こさないよう、経路を機械的に数えて台帳と突き合わせる。
 */
describe('自動取得コマンドの発行経路', () => {
  const ROOT = process.cwd()

  /**
   * 発行している場所と、T+0 に発令時刻を渡している証拠。
   *
   * 「発行元」は **`pending_command` を書く**ファイルに限る。
   * 型定義（src/lib/edge/commands.ts）とビルダー（flow.ts）にも
   * `action: 'start_bcp_capture'` の文字列は出るが、発行はしない。
   */
  const DISPATCHERS = [
    { file: 'supabase/functions/jalert-poller/index.ts', via: /buildBcpCaptureCommand\(/ },
    { file: 'src/app/api/bcp/test/route.ts',             via: /clipFrom:\s*alertIssuedAt/ },
    { file: 'src/app/api/bcp/[id]/retrieve/route.ts',    via: /clipFrom:\s*alertIssuedAt/ },
  ]

  /** 実際に pending_command で BCP 取得を発行しているファイル。 */
  function dispatchSites(): string[] {
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.tsx?$/.test(p) || /\.test\.tsx?$/.test(p)) continue
        const src = readFileSync(p, 'utf8')
        const mentions = /action:\s*'start_bcp_capture'/.test(src) || /buildBcpCaptureCommand\(/.test(src)
        // **発行元の条件は pending_command を実際に書くこと**（オブジェクトのキー）。
        // 型定義（説明文に pending_command が出るだけ）とビルダーはここで外れる。
        if (mentions && /pending_command:/.test(src)) found.push(p.slice(ROOT.length + 1))
      }
    }
    walk(join(ROOT, 'src'))
    walk(join(ROOT, 'supabase/functions'))
    return found.sort()
  }

  it('★台帳の各経路が、発令時刻を T+0 として渡している', () => {
    for (const d of DISPATCHERS) {
      const src = readFileSync(join(ROOT, d.file), 'utf8')
      expect(
        d.via.test(src),
        `${d.file}: T+0 に発令時刻を渡していません。「発令 − pre分」を渡すと全コマがずれます`,
      ).toBe(true)
    }
  })

  it('★台帳に載っていない発行経路が無い（増えたら落ちる）', () => {
    // 今回の不具合は「3 経路のうち 2 経路だけ直した」形だった。経路が増えた
    // ときに、この契約を知らないまま書かれるのを防ぐ。
    const found = dispatchSites()
    expect(found.length, '発行経路を 1 つも拾えていません（検出条件が壊れています）')
      .toBeGreaterThan(0)
    expect(found, '台帳（DISPATCHERS）に無い発行経路があります')
      .toEqual(DISPATCHERS.map((d) => d.file).sort())
  })
})
