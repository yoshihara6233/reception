/**
 * 手荷物検査モジュールのサイドバー（M4・ワイヤーフレーム v3 SCREEN G）
 *
 * AdminShell の nav/navTitle 上書きで使う（i18n セクション化は他モジュールの
 * 翻訳整備と合わせて後続）。アンマッチは履歴のフィルタチップ（?f=unmatched）へ着地。
 */
import type { NavItem } from '@/components/AdminShell'

export const BAGGAGE_NAV_TITLE = '手荷物検査'

export const BAGGAGE_NAV: NavItem[] = [
  { href: '/baggage',           label: '履歴',         icon: '☰', exact: true },
  { href: '/baggage/employees', label: '従業員マスタ', icon: '⚇' },
  { href: '/baggage/settings',  label: '設定',         icon: '⚙' },
]
