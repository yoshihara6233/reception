import { describe, expect, it } from 'vitest'
import { createFakeDb } from '@/test/fake-supabase'
import { countUnseenFeedback, isUnseenUpdate, markFeedbackSeen, operatorTouched } from './seen'

/**
 * テナント管理者の左メニューの「要望」の件数の印（基本設計 §3.6）。
 *   - 一覧を最後に開いたあとに、運営が状態・返事・対応の版を変えた要望を数える
 *   - 送ったばかりで運営がまだ触っていない要望は数えない
 *   - 一覧を開くと既読（feedback_seen）になり、印が消える
 *   - 自分のテナントの要望だけを数える
 */

const T = 'tenant-a'
const OTHER = 'tenant-b'
const U = 'user-1'

const item = (o: Record<string, unknown>) => ({
  id: crypto.randomUUID(), tenant_id: T, status: 'received', reply: null, fixed_version: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...o,
})

describe('operatorTouched / isUnseenUpdate', () => {
  it('送ったまま（受け付けました・返事なし・版なし）は運営が触っていない', () => {
    expect(operatorTouched({ status: 'received', reply: null, fixed_version: null })).toBe(false)
    expect(operatorTouched({ status: 'reviewing', reply: null, fixed_version: null })).toBe(true)
    expect(operatorTouched({ status: 'received', reply: '確認します', fixed_version: null })).toBe(true)
    expect(operatorTouched({ status: 'received', reply: null, fixed_version: '0.1.108' })).toBe(true)
  })

  it('★前に開いた時刻より後に変わったものだけが新しい', () => {
    const r = { status: 'answered', reply: '回答です', fixed_version: null, updated_at: '2026-10-05T10:00:00Z' }
    expect(isUnseenUpdate(r, '2026-10-05T09:00:00Z')).toBe(true)
    expect(isUnseenUpdate(r, '2026-10-05T10:00:00Z')).toBe(false)
    expect(isUnseenUpdate(r, '2026-10-05T11:00:00Z')).toBe(false)
  })

  it('一度も開いていなければ、運営が触ったものはすべて新しい', () => {
    expect(isUnseenUpdate({ status: 'planned', reply: null, fixed_version: null, updated_at: '2026-01-01T00:00:00Z' }, null)).toBe(true)
    expect(isUnseenUpdate({ status: 'received', reply: null, fixed_version: null, updated_at: '2026-10-06T00:00:00Z' }, null)).toBe(false)
  })
})

describe('countUnseenFeedback / markFeedbackSeen', () => {
  function seed(seen?: string) {
    return createFakeDb({
      feedback_items: [
        item({ status: 'answered', reply: '回答です', updated_at: '2026-10-05T10:00:00Z' }),
        item({ status: 'planned', updated_at: '2026-10-04T10:00:00Z' }),
        // 送ったばかり（運営が触っていない）は数えない
        item({ updated_at: '2026-10-06T08:00:00Z' }),
        // 他のテナントは数えない
        item({ tenant_id: OTHER, status: 'done', fixed_version: '0.1.108', updated_at: '2026-10-06T00:00:00Z' }),
      ],
      feedback_seen: seen ? [{ auth_user_id: U, tenant_id: T, seen_at: seen }] : [],
    })
  }
  const me = { userId: U, tenantId: T }

  it('★一度も開いていなければ、運営が触った自分のテナントの要望を数える', async () => {
    const db = seed()
    expect(await countUnseenFeedback(db.client as never, me)).toBe(2)
  })

  it('★開いた時刻より後に変わったものだけを数える', async () => {
    const db = seed('2026-10-05T00:00:00Z')
    expect(await countUnseenFeedback(db.client as never, me)).toBe(1)
  })

  it('★一覧を開いて既読にすると印が消え、その後の返事でまた付く', async () => {
    const db = seed()
    expect(await markFeedbackSeen(db.client as never, me, new Date('2026-10-06T09:00:00Z'))).toBe(true)
    expect(db.rows('feedback_seen')).toEqual([{ auth_user_id: U, tenant_id: T, seen_at: '2026-10-06T09:00:00.000Z' }])
    expect(await countUnseenFeedback(db.client as never, me)).toBe(0)

    // 運営が返事を書いた（updated_at が進む）
    db.rows('feedback_items')[2].reply = '検討します'
    db.rows('feedback_items')[2].updated_at = '2026-10-06T10:00:00Z'
    expect(await countUnseenFeedback(db.client as never, me)).toBe(1)

    // もう一度開くと、同じ行を上書きする（利用者ごとに 1 行）
    await markFeedbackSeen(db.client as never, me, new Date('2026-10-06T11:00:00Z'))
    expect(db.rows('feedback_seen')).toHaveLength(1)
    expect(await countUnseenFeedback(db.client as never, me)).toBe(0)
  })

  it('他の利用者の既読は、自分の印に効かない', async () => {
    const db = seed()
    await markFeedbackSeen(db.client as never, { userId: 'user-2', tenantId: T }, new Date('2026-10-06T09:00:00Z'))
    expect(await countUnseenFeedback(db.client as never, me)).toBe(2)
  })

  it('読めないときは null（印を出さない）', async () => {
    const broken = { from: () => { throw new Error('relation does not exist') } }
    expect(await countUnseenFeedback(broken as never, me)).toBeNull()
  })
})
