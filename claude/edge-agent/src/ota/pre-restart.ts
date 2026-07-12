/**
 * OTA 自己再起動前のクリーンアップ登録（実機障害 2026-07-12 の恒久対策）。
 *
 * 背景: requestSelfRestart() が process.exit(0) するだけだと、アクティブモードが
 * spawn した ffmpeg 子プロセスが cgroup に取り残される。systemd は残存プロセスへ
 * SIGTERM を送るが、WHIP の ffmpeg はセッション終了処理でハングし得るため
 * TimeoutStopSec(90s) を超過 → unit が 'failed/timeout' 扱い → **OnFailure の
 * ロールバックが誤発火**する（新版は無実なのに cooldown 入りする）。
 *
 * 対策: index.ts が「アクティブモード停止（= 子プロセス kill）」をここへ登録し、
 * requestSelfRestart が exit 前に必ず実行する。ハング保険として上限時間付き
 * （systemd の停止タイムアウトより十分短く）。
 */
import { logger } from '../logger.js'

type Cleanup = () => Promise<void>

const cleanups: Cleanup[] = []

/** exit 前に実行するクリーンアップを登録する（index.ts 起動時に1回）。 */
export function onPreRestart(fn: Cleanup): void {
  cleanups.push(fn)
}

/** テスト用: 登録をリセット。 */
export function resetPreRestart(): void {
  cleanups.length = 0
}

/**
 * 登録済みクリーンアップを実行。個々の失敗は握りつぶし（exit を止めない）、
 * 全体は timeoutMs で打ち切る（ハングした stop に道連れにされない）。
 */
export async function runPreRestart(timeoutMs = 8_000): Promise<void> {
  if (cleanups.length === 0) return
  logger.info({ count: cleanups.length }, 'ota: running pre-restart cleanups (stop children)')
  await Promise.race([
    Promise.allSettled(cleanups.map((f) => f().catch(() => {}))),
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ])
}
