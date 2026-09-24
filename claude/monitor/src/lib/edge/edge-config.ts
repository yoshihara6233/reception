/**
 * 遠隔投入する設定の許可キー（CONFIG_PUSH_SPEC §2）。
 *
 * **許可制**（strict）。ここに無いキーは管理 API で 400 に落とし、配信にも載せない
 * （クラウド侵害でも「決められた設定の範囲」しか動かせない）。nvmsd 側も未知キーは
 * 無視するが、入口の管理 API でも二重に縛る。
 *
 * 対象キーは第1弾の確定分。G・VMS が受けられるキーが増えたら、ここと UI を足すだけで
 * 安全に拡張できる（recording_schedule 等の複雑キーは確定後に追加）。
 */
import { z } from 'zod'

/** 遠隔投入できる設定。すべて任意・**未知キーは拒否**（strict）。 */
export const EdgeConfigSchema = z.object({
  // 録画の保持日数。
  retention_days: z.number().int().min(1).max(3650).optional(),
  // H.265 をそのまま配信するか（1台あたり CPU に効く・先日の設定漏れの類）。
  live_hevc_passthrough: z.boolean().optional(),
  // 動体検知しきい値（既定 0.30）。
  motion_sensitivity: z.number().min(0).max(1).optional(),
  // BCP スナップのオフセット（分）。
  snapshot_offsets: z.array(z.number().int().min(-1440).max(1440)).max(12).optional(),
}).strict()

export type EdgeConfig = z.infer<typeof EdgeConfigSchema>

/** UI 表示用のキー定義（ラベル・種別・説明）。順序＝表示順。 */
export const EDGE_CONFIG_KEYS = [
  { key: 'retention_days',        label: '録画の保持日数',       kind: 'int',    unit: '日',   hint: '1〜3650' },
  { key: 'live_hevc_passthrough', label: 'H.265 そのまま配信',   kind: 'bool',   unit: '',     hint: 'オフ=サーバ変換（CPU増）' },
  { key: 'motion_sensitivity',    label: '動体検知しきい値',     kind: 'float',  unit: '',     hint: '0.00〜1.00（既定 0.30）' },
  { key: 'snapshot_offsets',      label: 'BCP スナップ オフセット', kind: 'ints', unit: '分',   hint: 'カンマ区切り（例 -5,5,10,30）' },
] as const
