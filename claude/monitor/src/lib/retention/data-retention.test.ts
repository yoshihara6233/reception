import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * 保持期間の削除 (2026-10-30 発注者の決定)。
 *
 *   ★従業員の顔: 登録を外した人の消し残しと、1 年照合に使っていない顔を、Rekognition と写真の両方から消す
 *   ★Rekognition で消せなかった顔は列を残す (FaceId を失うと顔がコレクションに残り続ける)
 *   ★従業員の氏名: 登録を外してから 1 年で行ごと消す (顔が残っている行は消さない)
 *   ★BCP の生画像: 90 日で置き場と行を消し、発令に印を付ける。PDF は残す
 *   ★記録の表: 5 年・1 年・180 日 (遠隔視聴は置き場を消し終えた行だけ)
 *   ★dry_run は何も消さない
 */

const rk = vi.hoisted(() => ({
  calls: [] as { collection: string; faceIds: string[] }[],
  fail: new Set<string>(),
  throwAll: false,
}))
vi.mock('@/lib/aws/rekognition', () => ({
  employeeCollectionId: (storeId: string) => `baggage-emp-${storeId}`,
  deleteFacesInCollection: async (collection: string, faceIds: string[]) => {
    if (rk.throwAll) throw new Error('AWS credentials not configured')
    rk.calls.push({ collection, faceIds })
    return {
      deleted: faceIds.filter((f) => !rk.fail.has(f)),
      failed: faceIds.filter((f) => rk.fail.has(f)),
    }
  },
}))

import {
  bcpPathFromUrl, purgeBcpRaw, purgeDeactivatedEmployeeFaces, purgeDeactivatedEmployees,
  purgeOlderThan, purgeOrphanEmployeePhotos, purgeUnusedEmployeeFaces, retentionCutoffs, runDataRetention,
} from './data-retention'

const NOW = new Date('2026-11-01T03:30:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()
const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'

let db: ReturnType<typeof createFakeDb>
const svc = () => db.client as unknown as SupabaseClient
const emp = (id: string) => db.rows('employees').find((r) => r.id === id)
const put = (key: string, createdAt = ago(30)) => db.objects.set(key, { bytes: new Uint8Array([1]), createdAt })

beforeEach(() => {
  rk.calls = []
  rk.fail = new Set()
  rk.throwAll = false
  db = createFakeDb({
    employees: [
      // 登録を外したのに顔が残っている (画面の操作で消し損ねた)
      { id: 'e-left', store_id: S1, status: 'inactive', rekognition_face_id: 'f-left', face_photo_path: `employees/${S1}/e-left.jpg`, deactivated_at: ago(3) },
      // 1 年照合に使っていない
      { id: 'e-old', store_id: S1, status: 'active', rekognition_face_id: 'f-old', face_photo_path: `employees/${S1}/e-old.jpg`, face_last_matched_at: ago(366) },
      { id: 'e-old2', store_id: S2, status: 'active', rekognition_face_id: 'f-old2', face_photo_path: `employees/${S2}/e-old2.jpg`, face_last_matched_at: ago(400) },
      // 最近照合に使った
      { id: 'e-new', store_id: S1, status: 'active', rekognition_face_id: 'f-new', face_photo_path: `employees/${S1}/e-new.jpg`, face_last_matched_at: ago(10) },
      // 登録を外して 1 年を過ぎた (顔は消してある)
      { id: 'e-gone', store_id: S1, status: 'inactive', name: '山田', rekognition_face_id: null, face_photo_path: null, deactivated_at: ago(370) },
      // 登録を外して 1 年たっていない
      { id: 'e-recent-off', store_id: S1, status: 'inactive', name: '佐藤', rekognition_face_id: null, face_photo_path: null, deactivated_at: ago(200) },
    ],
  })
  put(`baggage-photos/employees/${S1}/e-left.jpg`)
  put(`baggage-photos/employees/${S1}/e-old.jpg`)
  put(`baggage-photos/employees/${S2}/e-old2.jpg`)
  put(`baggage-photos/employees/${S1}/e-new.jpg`)
})

describe('従業員の顔', () => {
  it('★登録を外した人の消し残しを、Rekognition と写真から消して列を空にする', async () => {
    const r = await purgeDeactivatedEmployeeFaces(svc(), NOW, false)
    expect(r).toMatchObject({ targets: 1, deleted: 1, failed: 0 })
    expect(rk.calls).toEqual([{ collection: `baggage-emp-${S1}`, faceIds: ['f-left'] }])
    expect(emp('e-left')).toMatchObject({ rekognition_face_id: null, face_photo_path: null })
    expect(db.objects.has(`baggage-photos/employees/${S1}/e-left.jpg`)).toBe(false)
    expect(db.rows('admin_audit_log')).toMatchObject([{ action: 'retention.employee.face_cleanup', target_id: 'e-left', actor_user_id: null }])
  })

  it('★1 年照合に使っていない顔だけを消す (店舗ごとのコレクション・従業員は登録のまま)', async () => {
    const r = await purgeUnusedEmployeeFaces(svc(), NOW, false)
    expect(r).toMatchObject({ targets: 2, deleted: 2, failed: 0 })
    expect(rk.calls.map((c) => c.collection).sort()).toEqual([`baggage-emp-${S1}`, `baggage-emp-${S2}`])
    expect(emp('e-old')).toMatchObject({ status: 'active', rekognition_face_id: null, face_photo_path: null })
    expect(emp('e-new')).toMatchObject({ rekognition_face_id: 'f-new' })
    expect(db.objects.has(`baggage-photos/employees/${S1}/e-new.jpg`)).toBe(true)
  })

  it('★Rekognition で消せなかった顔は列も写真も残す (次の実行でやり直す)', async () => {
    rk.fail.add('f-old')
    const r = await purgeUnusedEmployeeFaces(svc(), NOW, false)
    expect(r).toMatchObject({ deleted: 1, failed: 1 })
    expect(emp('e-old')).toMatchObject({ rekognition_face_id: 'f-old', face_photo_path: `employees/${S1}/e-old.jpg` })
    expect(db.objects.has(`baggage-photos/employees/${S1}/e-old.jpg`)).toBe(true)
  })

  it('★AWS が使えないときは何も書き換えない', async () => {
    rk.throwAll = true
    const r = await purgeUnusedEmployeeFaces(svc(), NOW, false)
    expect(r.deleted).toBe(0)
    expect(r.failed).toBe(2)
    expect(r.errors.join()).toMatch(/AWS credentials/)
    expect(emp('e-old')!.rekognition_face_id).toBe('f-old')
  })

  it('★写真を消せなければ、顔の列だけ空にして写真の列は残す', async () => {
    db.storageFail.remove = true
    const r = await purgeUnusedEmployeeFaces(svc(), NOW, false)
    expect(r.failed).toBe(2)
    expect(emp('e-old')).toMatchObject({ rekognition_face_id: null, face_photo_path: `employees/${S1}/e-old.jpg` })
  })

  it('dry_run は数えるだけ', async () => {
    const r = await purgeUnusedEmployeeFaces(svc(), NOW, true)
    expect(r).toMatchObject({ targets: 2, deleted: 0 })
    expect(rk.calls).toEqual([])
    expect(emp('e-old')!.rekognition_face_id).toBe('f-old')
  })
})

describe('従業員の氏名', () => {
  it('★登録を外してから 1 年たった行だけを消す (氏名は記録に残さない)', async () => {
    const r = await purgeDeactivatedEmployees(svc(), NOW, false)
    expect(r).toMatchObject({ targets: 1, deleted: 1, failed: 0 })
    expect(emp('e-gone')).toBeUndefined()
    expect(emp('e-recent-off')).toBeDefined()
    const audit = db.rows('admin_audit_log')
    expect(audit).toMatchObject([{ action: 'retention.employee.purge', target_id: 'e-gone' }])
    expect(JSON.stringify(audit)).not.toContain('山田')
  })

  it('★顔が残っている行は消さない (先に顔を消す)', async () => {
    db.rows('employees').find((r) => r.id === 'e-gone')!.rekognition_face_id = 'f-x'
    const r = await purgeDeactivatedEmployees(svc(), NOW, false)
    expect(r.targets).toBe(0)
    expect(emp('e-gone')).toBeDefined()
  })
})

describe('結び付きの無い顔写真', () => {
  it('★どの従業員の写真でもなく、置いてから 1 日たったものだけ消す', async () => {
    put(`baggage-photos/employees/${S1}/orphan.jpg`, ago(5))
    put(`baggage-photos/employees/${S1}/just-now.jpg`, new Date(NOW.getTime() - 60_000).toISOString())
    put(`baggage-photos/${S1}/20261031/visitor.jpg`, ago(5)) // 来訪者の写真 (別の処理) は対象外
    const r = await purgeOrphanEmployeePhotos(svc(), NOW, false)
    expect(r).toMatchObject({ targets: 1, deleted: 1 })
    expect(db.objects.has(`baggage-photos/employees/${S1}/orphan.jpg`)).toBe(false)
    expect(db.objects.has(`baggage-photos/employees/${S1}/just-now.jpg`)).toBe(true)
    expect(db.objects.has(`baggage-photos/employees/${S1}/e-new.jpg`)).toBe(true)
    expect(db.objects.has(`baggage-photos/${S1}/20261031/visitor.jpg`)).toBe(true)
  })
})

describe('BCP の生画像 (90 日)', () => {
  const EV_OLD = 'aaaaaaaa-0000-4000-8000-000000000001'
  const EV_NEW = 'aaaaaaaa-0000-4000-8000-000000000002'
  const EV_DONE = 'aaaaaaaa-0000-4000-8000-000000000003'
  beforeEach(() => {
    db = createFakeDb({
      bcp_events: [
        { id: EV_OLD, created_at: ago(91), raw_purged_at: null },
        { id: EV_NEW, created_at: ago(89), raw_purged_at: null },
        { id: EV_DONE, created_at: ago(200), raw_purged_at: ago(100) },
      ],
      bcp_clips: [
        { id: 'c1', event_id: EV_OLD, storage_path: `${EV_OLD}/cam1/+05_x.jpg` },
        { id: 'c2', event_id: EV_OLD, storage_path: null, clip_url: `https://x.supabase.co/storage/v1/object/public/bcp-clips/legacy/${EV_OLD}.mp4`, thumbnail_url: null },
        { id: 'c3', event_id: EV_NEW, storage_path: `${EV_NEW}/cam1/+05_x.jpg` },
      ],
      bcp_grid_shots: [{ id: 'g1', event_id: EV_OLD, storage_path: `${EV_OLD}/_grid/p001_+05_x.jpg` }],
      bcp_reports: [{ id: 'r1', event_id: EV_OLD, pdf_url: 'x' }],
    })
    put(`bcp-clips/${EV_OLD}/cam1/+05_x.jpg`)
    put(`bcp-clips/${EV_OLD}/cam1/-05_orphan.jpg`) // 行の無いファイルも消す
    put(`bcp-clips/${EV_OLD}/_grid/p001_+05_x.jpg`)
    put(`bcp-clips/legacy/${EV_OLD}.mp4`)
    put(`bcp-clips/${EV_NEW}/cam1/+05_x.jpg`)
    put(`bcp-reports/${EV_OLD}/report.pdf`)
  })

  it('★90 日を過ぎた発令の置き場と行を消し、印を付ける。PDF は残す', async () => {
    const r = await purgeBcpRaw(svc(), NOW, false)
    expect(r).toMatchObject({ targets: 1, deleted: 1, failed: 0, objects: 4, partial: false })
    expect([...db.objects.keys()].filter((k) => k.startsWith('bcp-clips/')).sort())
      .toEqual([`bcp-clips/${EV_NEW}/cam1/+05_x.jpg`])
    expect(db.rows('bcp_clips').map((c) => c.id)).toEqual(['c3'])
    expect(db.rows('bcp_grid_shots')).toEqual([])
    expect(db.rows('bcp_events').find((e) => e.id === EV_OLD)!.raw_purged_at).toBe(NOW.toISOString())
    expect(db.objects.has(`bcp-reports/${EV_OLD}/report.pdf`)).toBe(true)
    expect(db.rows('bcp_reports')).toHaveLength(1)
  })

  it('★置き場から消せなければ行も印も残す', async () => {
    db.storageFail.remove = true
    const r = await purgeBcpRaw(svc(), NOW, false)
    expect(r).toMatchObject({ deleted: 0, failed: 1 })
    expect(db.rows('bcp_clips')).toHaveLength(3)
    expect(db.rows('bcp_events').find((e) => e.id === EV_OLD)!.raw_purged_at).toBeNull()
  })

  it('dry_run は数えるだけ', async () => {
    const r = await purgeBcpRaw(svc(), NOW, true)
    expect(r).toMatchObject({ targets: 1, deleted: 0, objects: 0 })
    expect(db.objects.has(`bcp-clips/${EV_OLD}/cam1/+05_x.jpg`)).toBe(true)
  })

  it('昔の URL から置き場の場所を取り出す', () => {
    expect(bcpPathFromUrl('https://x.supabase.co/storage/v1/object/public/bcp-clips/a/b%20c.jpg?t=1')).toBe('a/b c.jpg')
    expect(bcpPathFromUrl('https://x.supabase.co/storage/v1/object/public/reports/a.pdf')).toBeNull()
    expect(bcpPathFromUrl(null)).toBeNull()
  })
})

describe('記録の表', () => {
  beforeEach(() => {
    db = createFakeDb({
      admin_audit_log: [
        { id: 1, ts: new Date(Date.UTC(2021, 9, 31)).toISOString() },  // 5 年より前
        { id: 2, ts: new Date(Date.UTC(2021, 10, 2)).toISOString() },  // 5 年以内
      ],
      live_sessions: [
        { id: 'l1', started_at: ago(367) },
        { id: 'l2', started_at: ago(300) },
      ],
      video_sessions: [
        { id: 'v1', created_at: ago(181), purged_at: ago(181) },
        { id: 'v2', created_at: ago(181), purged_at: null },  // 置き場を消し終えていない → 残す
        { id: 'v3', created_at: ago(100), purged_at: ago(100) },
      ],
    })
  })

  it('★期限 (5 年・1 年・180 日) を過ぎた行だけを消す', async () => {
    const c = retentionCutoffs(NOW)
    expect((await purgeOlderThan(svc(), 'admin_audit_log', 'ts', c.admin_audit_log, false)).deleted).toBe(1)
    expect((await purgeOlderThan(svc(), 'live_sessions', 'started_at', c.live_sessions, false)).deleted).toBe(1)
    expect((await purgeOlderThan(svc(), 'video_sessions', 'created_at', c.video_sessions, false, true)).deleted).toBe(1)
    expect(db.rows('admin_audit_log').map((r) => r.id)).toEqual([2])
    expect(db.rows('live_sessions').map((r) => r.id)).toEqual(['l2'])
    expect(db.rows('video_sessions').map((r) => r.id)).toEqual(['v2', 'v3'])
  })

  it('期限の時刻 (発注者の決定の値)', () => {
    expect(retentionCutoffs(NOW)).toEqual({
      employee_face_unused: '2025-11-01T03:30:00.000Z',
      employee_name: '2025-11-01T03:30:00.000Z',
      bcp_raw: '2026-08-03T03:30:00.000Z',
      admin_audit_log: '2021-11-01T03:30:00.000Z',
      live_sessions: '2025-11-01T03:30:00.000Z',
      video_sessions: '2026-05-05T03:30:00.000Z',
    })
  })
})

describe('まとめて回す', () => {
  it('★dry_run では何も消さず、数を返す', async () => {
    const before = JSON.stringify(db.rows('employees'))
    const objects = db.objects.size
    const s = await runDataRetention(svc(), { now: NOW, dryRun: true })
    expect(s.ok).toBe(true)
    expect(s.steps.employee_faces_unused.targets).toBe(2)
    expect(s.steps.employee_names.targets).toBe(1)
    expect(JSON.stringify(db.rows('employees'))).toBe(before)
    expect(db.objects.size).toBe(objects)
    expect(db.rows('admin_audit_log')).toEqual([])
    expect(rk.calls).toEqual([])
  })

  it('★1 つが失敗しても他は続け、ok を false にする', async () => {
    rk.throwAll = true
    const s = await runDataRetention(svc(), { now: NOW, dryRun: false })
    expect(s.ok).toBe(false)
    expect(s.steps.employee_faces_unused.failed).toBe(2)
    expect(s.steps.employee_names.deleted).toBe(1)
  })
})
