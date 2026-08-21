/**
 * アップロード上限に収めるための**判断**。ffmpeg を呼ばない純粋な計算だけを置く。
 *
 * ── なぜ分けるのか ──────────────────────────────────────────────────────
 * ここが決めるのは「収まるか」「どの帯域で作り直すか」「そもそも断るか」で、
 * どれも算術。ffmpeg の実行（window-mp4.ts）と混ぜると、env と外部プロセスが
 * 要る形になり、**肝心の算術を単体で確かめられなくなる**。
 * ops/*.ts と同じ「事実は外・判断はここ」の分け方に揃えた。
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * NVR は録画したビットレートのものしか返さない（httpdl.cgi に低画質を求める
 * 引数が無い）。長い区間ほど大きくなり、Supabase Storage の 1 ファイル上限に
 * 当たる。2026-08-21 に BCP の 5 分クリップで表面化したが、既存の VOD は
 * 最大 60 分を要求できるので、**同じ失敗は以前から起きていた**。
 */

/**
 * これ以上落とすと証跡として使えない、と判断する下限（kbps）。
 * ここを下回る要求は、**取得してから失敗させず先に断る**。
 */
export const MIN_VIDEO_KBPS = 300
/** 音声を残す帯域。証跡なので消さない（消すと後から戻せない）。 */
export const AUDIO_KBPS = 64
/** コンテナ overhead の見込み。実測が見積りを数 % 上回ることがある。 */
export const OVERHEAD_MARGIN = 0.95
/** この帯域を下回るなら、解像度を落としたほうが判別しやすい。 */
export const DOWNSCALE_BELOW_KBPS = 1500

/** 上限に収まる最長の長さ（秒）。「何分までなら取れるか」を出すのに使う。 */
export function maxFittableSec(capBytes: number): number {
  const bits = capBytes * 8 * OVERHEAD_MARGIN
  return Math.floor(bits / ((MIN_VIDEO_KBPS + AUDIO_KBPS) * 1000))
}

export type FitPlan =
  /** 上限内。**再エンコードしない**（CPU と世代劣化の無駄）。 */
  | { kind: 'as-is' }
  /** 作り直す。videoKbps で収まる見込み。 */
  | { kind: 're-encode'; videoKbps: number; downscale: boolean }
  /** どう作り直しても収まらない。理由は人が読む文面。 */
  | { kind: 'reject'; reason: string }

/** MB 表記。文言に出るので桁を揃える。 */
const mb = (bytes: number, digits = 1): string => (bytes / 1048576).toFixed(digits)

/**
 * 収めるための計画を立てる。
 *
 * @param bytes       いま手元にあるサイズ
 * @param durationSec 実際の長さ（NVR は分単位に丸めるので、要求値とずれる）
 * @param capBytes    Storage の 1 ファイル上限
 */
export function planFit(bytes: number, durationSec: number, capBytes: number): FitPlan {
  if (bytes <= capBytes) return { kind: 'as-is' }

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return {
      kind: 'reject',
      reason: `録画が大きすぎます（${mb(bytes)} MB / 上限 ${mb(capBytes, 0)} MB）。`
        + '長さを判定できないため縮小できません',
    }
  }

  const budgetKbps = Math.floor((capBytes * 8 * OVERHEAD_MARGIN) / durationSec / 1000)
  const videoKbps  = budgetKbps - AUDIO_KBPS
  if (videoKbps < MIN_VIDEO_KBPS) {
    const maxMin = Math.floor(maxFittableSec(capBytes) / 60)
    return {
      kind: 'reject',
      reason: `要求した ${Math.round(durationSec / 60)} 分は保存できません`
        + `（上限 ${mb(capBytes, 0)} MB では最長 ${maxMin} 分）。範囲を短くして取り直してください`,
    }
  }

  return {
    kind: 're-encode',
    videoKbps,
    // 低い帯域で高い解像度を維持すると、ブロックノイズで却って判別できなくなる。
    downscale: videoKbps < DOWNSCALE_BELOW_KBPS,
  }
}

/** 縮小後も超えていたときの文面。**上げる前に必ず確かめる**ための出口。 */
export function stillTooLargeReason(bytes: number, capBytes: number): string {
  return `縮小後も上限を超えました（${mb(bytes)} MB / 上限 ${mb(capBytes, 0)} MB）。`
    + '範囲を短くして取り直してください'
}
