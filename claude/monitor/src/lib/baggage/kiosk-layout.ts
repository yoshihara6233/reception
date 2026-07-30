/**
 * キオスクの画面向きとレイアウト寸法（純ロジック）
 *
 * 既設 iPad の流用案件で、端末が縦置き（カメラも縦向き）の店舗が出たため、
 * キオスク UI に縦向きレイアウトを持たせる。向きは店舗別設定
 * （inspection_settings.kiosk_orientation）。
 *
 * 寸法をここに集約する理由: KioskClient は 850 行超あり、画面ごとに固定 px が
 * 散っている。分岐を JSX に撒くと縦横どちらかが壊れても気づけないため、
 * **数値を1箇所に集めてテストで縦向きの収まりを検証**する。
 *
 * 想定端末:
 *   横置き iPad = 1080 × 810 / 1024 × 768 CSS px
 *   縦置き iPad =  768 × 1024 CSS px（最小幅。10.2" 以上はこれより広い）
 * 縦向きの寸法は **幅 768 px に収まること**を上限として決めている。
 */

export type KioskOrientation = 'landscape' | 'portrait'

export const KIOSK_ORIENTATIONS: readonly KioskOrientation[] = ['landscape', 'portrait'] as const

/** 縦置きで想定する最小の画面幅（CSS px）。この幅に収まるように寸法を決める。 */
export const PORTRAIT_MIN_WIDTH = 768

export interface KioskLayout {
  orientation: KioskOrientation

  /** アイドル画面で、区分ラベルを動作ボタンの上に置く（縦置き）か左に置く（横置き）か。 */
  idleStacked: boolean
  /** 動作ボタンを 1 行に何個並べるか。縦置きは 2 列に折り返す（4 動作 = 2 行）。 */
  idleBtnPerRow: number
  /** 横置きのみ: 区分ラベル列の幅。 */
  idleKindLabelWidth: number
  idleBtnWidth: number
  idleBtnHeight: number
  /** アイドル画面の要素間の間隔。 */
  idleGap: number

  /** 同意文・失敗パネルなど、広めのパネル幅。 */
  panelWide: number
  /** ボタン群など、中くらいのパネル幅。 */
  panelMid: number
  /** 顔撮影まわりのボタン幅。 */
  panelNarrow: number

  /** 顔プレビューの枠。縦置きは縦長にする（縦向きカメラの画をそのまま活かす）。 */
  faceBoxW: number
  faceBoxH: number
  /** 顔を合わせる楕円ガイド。 */
  faceGuideW: number
  faceGuideH: number

  /** 名刺プレビューの枠（名刺は横長なので縦置きでも横長のまま）。 */
  cardBoxW: number
  cardBoxH: number
  cardGuideW: number
  cardGuideH: number

  /** 名前選択（セルフ顔登録）のボタン群。 */
  regListMaxW: number
  regListMaxH: number
  regBtnMinW: number

  /** 見出しのフォントサイズ。 */
  h1: number
  h2: number
  /** 完了・あいさつの大きい文字。 */
  hDone: number
  /** 検査 STEP の主文字（横置き 64 / 縦置きは折り返しが増えるため小さめ）。 */
  stepFontSize: number
  /** STEP 画面の左右パディング。 */
  stepPadX: number
  /** 長文の折り返し幅。 */
  messageMaxW: number

  /** トップバーの左右パディング。 */
  topPadX: number
  /** 中央寄せ領域のパディング。 */
  centerPad: number
  /** 全画面ボタンの高さ（主/副）。 */
  primaryBtnH: number
  ghostBtnH: number
}

const LANDSCAPE: KioskLayout = {
  orientation: 'landscape',
  idleStacked: false,
  idleBtnPerRow: 4,
  idleKindLabelWidth: 110,
  idleBtnWidth: 180,
  idleBtnHeight: 104,
  idleGap: 24,
  panelWide: 760,
  panelMid: 720,
  panelNarrow: 520,
  faceBoxW: 520,
  faceBoxH: 390,
  faceGuideW: 230,
  faceGuideH: 300,
  cardBoxW: 560,
  cardBoxH: 360,
  cardGuideW: 420,
  cardGuideH: 250,
  regListMaxW: 780,
  regListMaxH: 360,
  regBtnMinW: 180,
  h1: 30,
  h2: 26,
  hDone: 40,
  stepFontSize: 64,
  stepPadX: 48,
  messageMaxW: 820,
  topPadX: 32,
  centerPad: 32,
  primaryBtnH: 80,
  ghostBtnH: 56,
}

/**
 * 縦置き（768 × 1024 想定）。
 * - 区分ラベルは動作ボタンの上へ。横一列だと 768 px に収まらないため。
 * - 動作ボタンは **2 列に折り返す**。terminal_mode='both' は 4 動作あり、1 列に積むと
 *   区分 2 つで 900 px を超えて縦にも溢れる（実機確認で見出しが切れた）。2 列なら
 *   4 動作 = 2 行に収まり、ボタンの大きさも保てる。
 * - 顔プレビューは縦長（3:4）。縦向きカメラの画を上下で切らない。
 * - STEP 文字は 64 → 52。縦幅は余るが横幅が足りず、64 のままだと折り返しが増えて読みづらい。
 */
const PORTRAIT: KioskLayout = {
  orientation: 'portrait',
  idleStacked: true,
  idleBtnPerRow: 2,
  idleKindLabelWidth: 0,
  idleBtnWidth: 340,
  idleBtnHeight: 86,
  idleGap: 16,
  panelWide: 640,
  panelMid: 620,
  panelNarrow: 560,
  faceBoxW: 480,
  faceBoxH: 640,
  faceGuideW: 268,
  faceGuideH: 348,
  cardBoxW: 620,
  cardBoxH: 400,
  cardGuideW: 470,
  cardGuideH: 280,
  regListMaxW: 660,
  regListMaxH: 520,
  regBtnMinW: 300,
  h1: 27,
  h2: 23,
  hDone: 34,
  stepFontSize: 52,
  stepPadX: 28,
  messageMaxW: 660,
  topPadX: 20,
  centerPad: 24,
  primaryBtnH: 76,
  ghostBtnH: 54,
}

/**
 * DB の値を向きに正規化する。未設定・未知の値は 'landscape'（既存店舗の挙動を変えない）。
 */
export function normalizeOrientation(v: unknown): KioskOrientation {
  return v === 'portrait' ? 'portrait' : 'landscape'
}

/** 向きに対応するレイアウト寸法を返す。 */
export function kioskLayout(orientation: KioskOrientation): KioskLayout {
  return orientation === 'portrait' ? PORTRAIT : LANDSCAPE
}

/** PWA manifest の orientation 値（ホーム画面から起動したとき向きを固定する）。 */
export function manifestOrientation(orientation: KioskOrientation): 'portrait' | 'landscape' {
  return orientation === 'portrait' ? 'portrait' : 'landscape'
}

/** 表示用ラベル。 */
export const ORIENTATION_LABEL: Record<KioskOrientation, string> = {
  landscape: '横置き',
  portrait: '縦置き',
}
