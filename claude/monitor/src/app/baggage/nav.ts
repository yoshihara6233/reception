/**
 * 手荷物検査モジュールのサイドバー（M4・ワイヤーフレーム v3 SCREEN G）
 *
 * AdminShell の nav/navTitle 上書きで使う（i18n セクション化は他モジュールの
 * 翻訳整備と合わせて後続）。アンマッチは履歴のフィルタチップ（?f=unmatched）へ着地。
 */
import type { NavItem } from '@/components/AdminShell'

export const BAGGAGE_NAV_TITLE = '手荷物検査'

// 設定（共通・店舗別）は管理（/admin/baggage）に集約したためサイドバーから撤去。
export const BAGGAGE_NAV: NavItem[] = [
  { href: '/baggage',           label: '履歴',         icon: '☰', exact: true },
  { href: '/baggage/employees', label: '従業員マスタ', icon: '⚇' },
]
