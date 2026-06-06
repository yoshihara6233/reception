/**
 * F48.B: CommandDispatcher — pending_commands → adapter コマンド実行
 *
 * 担当店舗の pending_commands をポーリング、claim、実行、結果書き戻し。
 * adapter は registry から動的解決。capability チェック → commands/ に dispatch。
 *
 * Phase 1: claim ロジックを SELECT FOR UPDATE SKIP LOCKED で実装予定だが、
 * 暫定的に "UPDATE WHERE status='pending'" の楽観排他で進める。複数 worker
 * 並行時は衝突するが、commands が冪等なので大事故にはならない。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from '../../adapters/_registry'
import { resolveCredentialsCached } from '../../adapters/_base/credential-resolver'
import { adapterCache } from '../../adapters/_registry'
import {
  handleCaptureSnapshot, handleStartLive, handleExportVod, handleStartBcpCapture,
} from '../../commands'
import { globalBreaker, CircuitOpenError } from '../../util/circuit-breaker'
import { m_commands_total, m_command_latency } from '../../util/metrics'
import type { TenantStore } from './types'
import type { TenantPool } from './tenant-pool'

let _supa: SupabaseClient | null = null
export function _setSupa(client: SupabaseClient): void { _supa = client }
function getSupa(): SupabaseClient {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
  }
  return _supa
}

interface PendingCommandRow {
  id:        string
  store_id:  string
  command:   string
  payload:   Record<string, unknown> | null
  status:    string
  claimed_by: string | null
  claimed_at: string | null
}

export class CommandDispatcher {
  private pollTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly nodeId:    string,
    private readonly pool:      TenantPool,
    private readonly pollIntervalMs: number,
  ) {}

  start(): void {
    this.pollTimer = setInterval(() => {
      void this.pollOnce().catch((err) => {
        console.error('CommandDispatcher poll failed', err)
      })
    }, this.pollIntervalMs)
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /** 1 ポーリングサイクル: 担当店舗の pending_commands を全件取得 → 実行 */
  async pollOnce(): Promise<{ executed: number; failed: number }> {
    const storeIds = this.pool.list().map((t) => t.storeId)
    if (storeIds.length === 0) return { executed: 0, failed: 0 }

    const { data, error } = await getSupa()
      .from('pending_commands')
      .select('id, store_id, command, payload, status, claimed_by, claimed_at')
      .in('store_id', storeIds)
      .eq('status', 'pending')
      .order('created_at')
      .limit(50)
    if (error) {
      console.error('pollOnce select error', error)
      return { executed: 0, failed: 0 }
    }

    let executed = 0, failed = 0
    for (const cmd of (data ?? []) as PendingCommandRow[]) {
      const tenant = this.pool.get(cmd.store_id)
      if (!tenant) continue   // pool 変動: 既に他ノードへ移籍

      const ok = await this.executeOne(cmd, tenant)
      if (ok) executed++
      else failed++
    }
    return { executed, failed }
  }

  private async executeOne(cmd: PendingCommandRow, tenant: TenantStore): Promise<boolean> {
    const t0 = Date.now()
    const vendor = tenant.nvrVendor ?? 'unknown'
    // 楽観 claim
    const { error: claimErr } = await getSupa()
      .from('pending_commands')
      .update({
        status:     'claimed',
        claimed_by: this.nodeId,
        claimed_at: new Date().toISOString(),
      })
      .eq('id', cmd.id)
      .eq('status', 'pending')
    if (claimErr) return false

    try {
      // adapter 解決
      if (!tenant.nvrVendor || !tenant.nvrEndpoint) {
        throw new Error(`store ${tenant.storeId} has no NVR config`)
      }
      // narrow を closure 外で行う (TS は async callback 内で narrowing を保持しない)
      const vendor    = tenant.nvrVendor
      const endpoint  = tenant.nvrEndpoint
      // F49.D: サーキットブレーカーで隔離。OPEN の店舗は即 fail
      const adapter = await globalBreaker.exec(tenant.storeId, async () => {
        const creds = tenant.nvrCredentialsRef
          ? await resolveCredentialsCached(tenant.nvrCredentialsRef)
          : { username: 'admin', password: '' }  // Phase 0 暫定
        return adapterCache.getOrCreate(
          tenant.storeId,
          {
            storeId:     tenant.storeId,
            vendor,
            endpoint,
            credentials: creds,
            options:     tenant.nvrOptions,
          },
          tenant.nvrFwVersion,
        )
      })

      const ctx = { adapter, store: {
        storeId:           tenant.storeId,
        nvrVendor:         tenant.nvrVendor,
        nvrEndpoint:       tenant.nvrEndpoint,
        nvrCredentialsRef: tenant.nvrCredentialsRef ?? '',
        nvrOptions:        tenant.nvrOptions,
      }, commandId: cmd.id }

      // dispatch
      const payload = (cmd.payload ?? {}) as Record<string, unknown>
      switch (cmd.command) {
        case 'capture_snapshot':
          await handleCaptureSnapshot(ctx, { channel: Number(payload.channel ?? 1) })
          break
        case 'start_live':
          await handleStartLive(ctx, {
            channel: Number(payload.channel ?? 1),
            stream:  payload.stream === 'sub' ? 'sub' : 'main',
          })
          break
        case 'export_vod':
          await handleExportVod(ctx, {
            channel: Number(payload.channel ?? 1),
            fromIso: String(payload.from_iso ?? ''),
            toIso:   String(payload.to_iso ?? ''),
          })
          break
        case 'start_bcp_capture':
          await handleStartBcpCapture(ctx, {
            channel:        Number(payload.channel ?? 1),
            referenceAtIso: String(payload.reference_at ?? new Date().toISOString()),
          })
          break
        default:
          throw new Error(`unknown command: ${cmd.command}`)
      }

      await getSupa()
        .from('pending_commands')
        .update({ status: 'completed' })
        .eq('id', cmd.id)
      // F50.C: メトリクス記録 (成功)
      m_commands_total.inc({ command: cmd.command, result: 'ok', vendor })
      m_command_latency.observeMs(Date.now() - t0, { command: cmd.command, vendor })
      return true
    } catch (err) {
      // F49.D: CircuitOpenError は「NVR 障害でスキップ」扱い (status=failed だが
      // error メッセージで判別可能)
      const isCircuit = err instanceof CircuitOpenError
      const errorMsg = isCircuit
        ? `[CIRCUIT_OPEN] ${(err as Error).message}`
        : (err as Error).message
      await getSupa()
        .from('pending_commands')
        .update({ status: 'failed', error: errorMsg })
        .eq('id', cmd.id)
      // F50.C: メトリクス記録 (失敗)
      const resultLabel = isCircuit ? 'circuit_open' : 'error'
      m_commands_total.inc({ command: cmd.command, result: resultLabel, vendor })
      m_command_latency.observeMs(Date.now() - t0, { command: cmd.command, vendor })
      return false
    }
  }
}

// unused-import warning 抑止 (adapter cache の dynamic は registry 経由)
void getAdapter
