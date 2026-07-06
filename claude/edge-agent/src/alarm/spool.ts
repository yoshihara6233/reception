/**
 * 発報スプールの配線側（ファイル IO・再送タイマ）。判定ロジックは spool-core.ts。
 *
 * 置き場: <TMP_DIR>/alarm-spool/<受信epochms>-<乱数>.json
 * 再送: RETRY_INTERVAL_MS ごとに古い順で送る。transient は残す（attempts++）、
 * ok / permanent / 期限切れ(24h) は削除。クラウド復帰後、発報は元の occurred_at で記録される。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { logger } from '../logger.js'
import {
  type SpooledAlarm, type SendOutcome,
  spoolFileName, receivedMsFromFileName, isExpired, encodeEntry, decodeEntry,
  SPOOL_MAX_ENTRIES,
} from './spool-core.js'

const RETRY_INTERVAL_MS = 60_000

function spoolDir(): string {
  return join(config.TMP_DIR, 'alarm-spool')
}

/** 発報 1 件をスプールへ退避する（失敗はログのみ・呼び出し側は継続）。 */
export function spoolAlarm(entry: SpooledAlarm): void {
  try {
    const dir = spoolDir()
    mkdirSync(dir, { recursive: true })
    // ディスク保護: 上限超なら最も古いものから捨てる（新しい発報を優先）。
    const names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
    for (let i = 0; i <= names.length - SPOOL_MAX_ENTRIES; i++) {
      unlinkSync(join(dir, names[i]))
      logger.error({ dropped: names[i] }, 'alarm-spool: 上限超過で最古エントリを破棄')
    }
    const name = spoolFileName(Date.now(), randomBytes(4).toString('hex'))
    writeFileSync(join(dir, name), encodeEntry(entry))
    logger.warn({ file: name, dedup_key: entry.dedup_key }, 'alarm-spool: 送信失敗分を退避（後で再送）')
  } catch (e) {
    logger.error({ err: String(e) }, 'alarm-spool: 退避に失敗（発報がロストします）')
  }
}

/**
 * スプール再送ループを開始。send は listener 側の送信関数（分類済み結果を返す）。
 * 戻りの close() で停止。
 */
export function startAlarmSpoolRetry(
  send: (entry: SpooledAlarm) => Promise<SendOutcome>,
): { close: () => void } {
  let running = false

  async function drainOnce(): Promise<void> {
    if (running) return
    running = true
    try {
      let names: string[]
      try { names = readdirSync(spoolDir()).filter((n) => n.endsWith('.json')).sort() } catch { return } // ディレクトリ未作成＝スプール空
      for (const name of names) {
        const path = join(spoolDir(), name)
        const receivedMs = receivedMsFromFileName(name)
        if (receivedMs === null || isExpired(receivedMs, Date.now())) {
          logger.error({ file: name }, 'alarm-spool: 期限切れ/不正名 → 破棄（発報ロスト）')
          try { unlinkSync(path) } catch { /* 既に無い */ }
          continue
        }
        let entry: SpooledAlarm | null = null
        try { entry = decodeEntry(readFileSync(path, 'utf8')) } catch { /* 読めない */ }
        if (!entry) {
          logger.error({ file: name }, 'alarm-spool: 壊れたエントリ → 破棄')
          try { unlinkSync(path) } catch { /* 既に無い */ }
          continue
        }
        const outcome = await send(entry)
        if (outcome === 'transient') {
          // クラウド未復帰。以降のエントリも失敗する見込みなので今回はここで打ち切り。
          entry.attempts += 1
          try { writeFileSync(path, encodeEntry(entry)) } catch { /* 次回再試行 */ }
          logger.info({ file: name, attempts: entry.attempts }, 'alarm-spool: 再送失敗（次回再試行）')
          return
        }
        try { unlinkSync(path) } catch { /* 既に無い */ }
        if (outcome === 'ok') logger.info({ file: name, dedup_key: entry.dedup_key }, 'alarm-spool: 再送成功')
        else logger.error({ file: name }, 'alarm-spool: 恒久エラー応答 → 破棄')
      }
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => { void drainOnce() }, RETRY_INTERVAL_MS)
  // 起動直後にも 1 回（restart 中に溜まった分の早期回収）。
  setTimeout(() => { void drainOnce() }, 5_000)
  try {
    const n = readdirSync(spoolDir()).length
    if (n > 0) logger.warn({ pending: n }, 'alarm-spool: 未送信の発報が残っています（再送します）')
  } catch { /* 未作成 */ }
  return { close: () => clearInterval(timer) }
}
