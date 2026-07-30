import { describe, it, expect } from 'vitest'
import {
  KIOSK_ORIENTATIONS, PORTRAIT_MIN_WIDTH, ORIENTATION_LABEL,
  kioskLayout, normalizeOrientation, manifestOrientation,
  type KioskOrientation,
} from './kiosk-layout'
import { availableActions } from './inspection-flow'

/** terminal_mode='both' の動作数（実装から取る。決め打ちにすると増減に気づけない）。 */
const MAX_ACTIONS = availableActions('both').length

describe('normalizeOrientation', () => {
  it("'portrait' はそのまま", () => {
    expect(normalizeOrientation('portrait')).toBe('portrait')
  })

  it.each([undefined, null, '', 'landscape', 'LANDSCAPE', 'Portrait', 0, {}, []])(
    '未設定・未知の値 %p は landscape に倒す（既存店舗の挙動を変えない）',
    (v) => { expect(normalizeOrientation(v)).toBe('landscape') },
  )
})

describe('kioskLayout', () => {
  it('向きがそのまま入る', () => {
    for (const o of KIOSK_ORIENTATIONS) {
      expect(kioskLayout(o).orientation).toBe(o)
    }
  })

  it('縦置きは区分ラベルを積む / 横置きは横に並べる', () => {
    expect(kioskLayout('portrait').idleStacked).toBe(true)
    expect(kioskLayout('landscape').idleStacked).toBe(false)
  })

  it('縦置きの顔プレビューは縦長・横置きは横長', () => {
    const p = kioskLayout('portrait')
    const l = kioskLayout('landscape')
    expect(p.faceBoxH).toBeGreaterThan(p.faceBoxW)
    expect(l.faceBoxW).toBeGreaterThan(l.faceBoxH)
  })

  it('名刺プレビューは向きに関わらず横長（名刺が横長のため）', () => {
    for (const o of KIOSK_ORIENTATIONS) {
      const L = kioskLayout(o)
      expect(L.cardBoxW).toBeGreaterThan(L.cardBoxH)
    }
  })

  it('顔ガイドはプレビュー枠の内側に収まる', () => {
    for (const o of KIOSK_ORIENTATIONS) {
      const L = kioskLayout(o)
      expect(L.faceGuideW).toBeLessThan(L.faceBoxW)
      expect(L.faceGuideH).toBeLessThan(L.faceBoxH)
    }
  })

  it('名刺ガイドはプレビュー枠の内側に収まる', () => {
    for (const o of KIOSK_ORIENTATIONS) {
      const L = kioskLayout(o)
      expect(L.cardGuideW).toBeLessThan(L.cardBoxW)
      expect(L.cardGuideH).toBeLessThan(L.cardBoxH)
    }
  })
})

describe('縦置きは 768 px 幅に収まる', () => {
  const L = kioskLayout('portrait')
  const usable = PORTRAIT_MIN_WIDTH - L.centerPad * 2

  it.each([
    ['panelWide', () => L.panelWide],
    ['panelMid', () => L.panelMid],
    ['panelNarrow', () => L.panelNarrow],
    ['faceBoxW', () => L.faceBoxW],
    ['cardBoxW', () => L.cardBoxW],
    ['regListMaxW', () => L.regListMaxW],
    ['messageMaxW', () => L.messageMaxW],
    ['idleBtnWidth', () => L.idleBtnWidth],
  ])('%s は使用可能幅 %d px 以内', (_name, get) => {
    expect(get()).toBeLessThanOrEqual(usable)
  })

  it('STEP 画面の左右パディングを引いても本文領域が残る', () => {
    expect(PORTRAIT_MIN_WIDTH - L.stepPadX * 2).toBeGreaterThan(600)
  })

  it('区分ラベル列の幅は使わない（積むため 0）', () => {
    expect(L.idleKindLabelWidth).toBe(0)
  })
})

describe('横置きは 1024 px 幅に収まる（旧 iPad の下限）', () => {
  const L = kioskLayout('landscape')
  const usable = 1024 - L.centerPad * 2

  it.each([
    ['panelWide', () => L.panelWide],
    ['faceBoxW', () => L.faceBoxW],
    ['regListMaxW', () => L.regListMaxW],
  ])('%s は使用可能幅以内', (_name, get) => {
    expect(get()).toBeLessThanOrEqual(usable)
  })

  it('区分ラベル + 全動作ボタンが 1 行に収まる', () => {
    const GAP = 14
    expect(L.idleBtnPerRow).toBeGreaterThanOrEqual(MAX_ACTIONS)
    const row = L.idleKindLabelWidth + L.idleBtnWidth * MAX_ACTIONS + GAP * MAX_ACTIONS
    expect(row).toBeLessThanOrEqual(usable)
  })
})

describe('縦置きのアイドル画面が 1024 px 高に収まる', () => {
  const L = kioskLayout('portrait')
  const TOP_BAR = 64
  const KINDS = 2                // 従業員 / 来訪者
  const BTN_GAP = 12             // KioskClient のボタン間 gap

  // 4 動作を 1 列に積んだ実装は実機で縦に溢れ、見出しが切れた。行数で数えること。
  const rows = Math.ceil(MAX_ACTIONS / L.idleBtnPerRow)

  it('動作ボタンが 2 列に折り返る（1 列だと溢れる）', () => {
    expect(L.idleBtnPerRow).toBe(2)
    expect(rows).toBeLessThanOrEqual(2)
  })

  it('ボタン 2 列 + gap が 768 px 幅に収まる', () => {
    const row = L.idleBtnWidth * L.idleBtnPerRow + BTN_GAP * (L.idleBtnPerRow - 1)
    expect(row).toBeLessThanOrEqual(PORTRAIT_MIN_WIDTH - L.centerPad * 2)
  })

  it('区分ラベル + 動作ボタンを積んでも縦に収まる', () => {
    const kindBlock = 30 + rows * L.idleBtnHeight + (rows - 1) * BTN_GAP
    const total =
      TOP_BAR + L.centerPad * 2 +
      L.h1 + L.idleGap +
      kindBlock * KINDS + L.idleGap +
      24 + L.ghostBtnH          // 注記 + 顔登録ボタン
    expect(total).toBeLessThanOrEqual(1024)
  })
})

describe('manifestOrientation', () => {
  it('ホーム画面起動時の向きを固定する', () => {
    expect(manifestOrientation('portrait')).toBe('portrait')
    expect(manifestOrientation('landscape')).toBe('landscape')
  })
})

describe('ORIENTATION_LABEL', () => {
  it('全ての向きに日本語ラベルがある', () => {
    for (const o of KIOSK_ORIENTATIONS) {
      expect(ORIENTATION_LABEL[o as KioskOrientation]).toBeTruthy()
    }
  })
})
