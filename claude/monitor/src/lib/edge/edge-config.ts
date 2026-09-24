/**
 * 遠隔投入する設定の許可キー（CONFIG_PUSH_SPEC §2）。
 *
 * **許可制**（strict）。ここに無いキーは管理 API で 400 に落とし、配信にも載せない
 * （クラウド侵害でも「決められた設定の範囲」しか動かせない）。nvmsd 側も未知キーは
 * 無視するが、入口の管理 API でも二重に縛る。
 *
 * 対象キーは第1弾の確定分（CONFIG_PUSH_SPEC 付録A.2 で G・VMS と合意・2026-09-24）。
 * motion_sensitivity は外した（G・VMS の値は「小さいほど敏感」のしきい値で名前と意味が逆。
 * 次版で motion_threshold として出す案）。G・VMS が受けられるキーが増えたら、ここと UI を
 * 足すだけで安全に拡張できる（recording_schedule 等の複雑キーは確定後に追加）。
 */
import { z } from 'zod'

/** 遠隔投入できる設定。すべて任意・**未知キーは拒否**（strict）。 */
export const EdgeConfigSchema = z.object({
  // 録画の保持日数。0（無期限）は受けない。**減らす変更は拠点側の許可
  // （NVMS_REMOTE_RETENTION_DECREASE=true）が無いと適用されない**（付録A.3・録画消去は不可逆）。
  retention_days: z.number().int().min(1).max(3650).optional(),
  // H.265 をそのまま配信するか（1台あたり CPU に効く・先日の設定漏れの類）。
  live_hevc_passthrough: z.boolean().optional(),
  // BCP スナップのオフセット（分）。nvmsd と同じ範囲（各 −60〜60・1〜12 個）に揃え、
  // 重複除去＋昇順に正規化する（範囲外を保存して「反映待ち」のまま、を入口で防ぐ）。
  snapshot_offsets: z.array(z.number().int().min(-60).max(60)).min(1).max(12)
    .transform((a) => [...new Set(a)].sort((x, y) => x - y))
    .optional(),
}).strict()

export type EdgeConfig = z.infer<typeof EdgeConfigSchema>

/**
 * 配信直前のふるい: 許可キーかつ値が妥当なものだけを残す（キー単位）。
 * 契約から外したキーの残骸で nvmsd が永久に「反映待ち」になるのを防ぐ。
 */
export function allowedConfig(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!raw || typeof raw !== 'object') return out
  const shape = EdgeConfigSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = shape[k]
    if (!field) continue
    const r = field.safeParse(v)
    if (r.success && r.data !== undefined) out[k] = r.data
  }
  return out
}

/** UI 表示用のキー定義（ラベル・種別・説明）。順序＝表示順。 */
export const EDGE_CONFIG_KEYS = [
  { key: 'retention_days',        label: '録画の保持日数',       kind: 'int',    unit: '日',   hint: '1〜3650' },
  { key: 'live_hevc_passthrough', label: 'H.265 そのまま配信',   kind: 'bool',   unit: '',     hint: 'オフ=サーバ変換（CPU増）' },
  { key: 'snapshot_offsets',      label: 'BCP スナップ オフセット', kind: 'ints', unit: '分',   hint: '各 −60〜60・カンマ区切り（例 -5,5,10,30）' },
] as const
