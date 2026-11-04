// 内部名を画面・PDF に出さない (2026-11-04・シナリオ試験の所見)
import { describe, it, expect } from 'vitest'
import { bcpAlertTypeLabel, bcpStatusLabel } from './labels'
import { alarmKindLabel, alarmSourceLabel } from '@/lib/alarms/event-label'
import { planLabel, tenantStatusLabel } from '@/lib/tenant/labels'

describe('表示名', () => {
  it('BCP の種別と状態', () => {
    expect(bcpAlertTypeLabel('earthquake')).toBe('震度情報')
    expect(bcpStatusLabel('recording')).toBe('録画中')
    expect(bcpAlertTypeLabel('earthquake', 'en')).toBe('Earthquake')
    expect(bcpAlertTypeLabel('volcano')).toBe('volcano')
  })
  it('発報の種類と受信元', () => {
    expect(alarmKindLabel('motion', 'onvif')).toBe('動体検知')
    expect(alarmKindLabel(null, 'ipro')).toBe('i-PRO')
    expect(alarmKindLabel('custom_x', 'webhook')).toBe('custom_x')
    expect(alarmSourceLabel('nvms')).toBe('拠点の G・VMS')
  })
  it('料金プランとテナントの状態', () => {
    expect(planLabel('starter')).toBe('スターター')
    expect(tenantStatusLabel('trial')).toBe('トライアル')
    expect(planLabel('custom')).toBe('custom')
  })
})
