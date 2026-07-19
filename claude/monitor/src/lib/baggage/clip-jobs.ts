/**
 * クリップ切り出しジョブの純ロジック（M2 → M5 エッジ実装と共有する契約）
 *
 * 実体は @intereco/shared/baggage に移設（monitor のキオスクAPIがジョブ生成し、
 * edge-agent の切り出しワーカが消化するため、両 app で同じ契約を使う）。
 * ここは後方互換の再エクスポート（既存 import と M2 テストを壊さない）。
 */
export {
  buildClipJobs,
  validateClipReport,
  nextRetryAt,
  isPastDeadline,
  RETRY_DELAYS_SEC,
  type ClipJobSettings,
  type ClipJobSpec,
  type ClipReport,
  type ClipValidation,
} from '@intereco/shared/baggage'
