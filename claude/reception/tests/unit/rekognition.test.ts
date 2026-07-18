/**
 * Rekognition 共通ラッパの回帰テスト（T3・CRITICAL）
 *
 * 目的:
 *   (1) コレクション名引数化リファクタ後も、既存来訪者 face-auth の後方互換
 *       シグネチャ（indexFace/searchFacesByImage/deleteFace）が「reception-<tenant>」
 *       コレクションへ、同じ ExternalImageId・同じ戻り値形（visitorId）で動くこと。
 *   (2) 新コア層がコレクション名を素通しし、従業員/来訪者コレクションを分離できること。
 *
 * AWS SDK をモックし、送信された Command の CollectionId / ExternalImageId を検証する
 * （実 AWS を叩かない・CIで常時緑）。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const sendMock = vi.fn()

vi.mock('@aws-sdk/client-rekognition', () => {
  class Cmd {
    input: unknown
    _t = 'Base'
    constructor(input: unknown) { this.input = input }
  }
  return {
    RekognitionClient: class { send = sendMock },
    CreateCollectionCommand:  class extends Cmd { _t = 'CreateCollection' },
    IndexFacesCommand:        class extends Cmd { _t = 'IndexFaces' },
    SearchFacesByImageCommand:class extends Cmd { _t = 'SearchFacesByImage' },
    DeleteFacesCommand:       class extends Cmd { _t = 'DeleteFaces' },
  }
})

import {
  tenantCollectionId,
  employeeCollectionId,
  visitorDailyCollectionId,
  ensureCollectionById,
  indexFaceInCollection,
  searchFaceInCollection,
  deleteFaceInCollection,
  indexFace,
  searchFacesByImage,
  deleteFace,
} from '@/lib/aws/rekognition'

type SentCmd = { _t: string; input: Record<string, unknown> }

/** 送信された Command のうち種別 t のものの input を返す（最後の1件）。 */
function lastInput(t: string): Record<string, unknown> | undefined {
  const calls = sendMock.mock.calls as unknown as [SentCmd][]
  const hit = [...calls].reverse().find(([c]) => c._t === t)
  return hit?.[0].input
}

beforeEach(() => {
  sendMock.mockReset()
  process.env.AWS_REGION = 'us-east-1'
  process.env.AWS_ACCESS_KEY_ID = 'test'
  process.env.AWS_SECRET_ACCESS_KEY = 'test'
  // 既定: CreateCollection は成功、その他は各テストで上書き
  sendMock.mockImplementation((cmd: SentCmd) => {
    if (cmd._t === 'CreateCollection') return Promise.resolve({})
    return Promise.resolve({})
  })
})

describe('コレクション名ビルダー', () => {
  test('テナント（既存 face-auth）の名前が従来と一致', () => {
    expect(tenantCollectionId('t1')).toBe('reception-t1')
    // UUID 中のハイフンは許容・その他はハイフンへ
    expect(tenantCollectionId('abc.def')).toBe('reception-abc-def')
  })
  test('従業員コレクションは店舗単位で分離', () => {
    expect(employeeCollectionId('store-1')).toBe('baggage-emp-store-1')
  })
  test('来訪者コレクションは店舗×日で分離', () => {
    expect(visitorDailyCollectionId('store-1', '20260718')).toBe('baggage-store-1-20260718')
  })
})

describe('後方互換: 既存来訪者 face-auth（回帰・CRITICAL）', () => {
  test('indexFace は reception-<tenant> へ visitorId を ExternalImageId で登録', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'CreateCollection') return Promise.resolve({})
      if (cmd._t === 'IndexFaces') {
        return Promise.resolve({ FaceRecords: [{ Face: { FaceId: 'face-abc', Confidence: 99 } }] })
      }
      return Promise.resolve({})
    })

    const r = await indexFace('tenant-9', 'visitor-7', Buffer.from('img'))

    expect(lastInput('IndexFaces')?.CollectionId).toBe('reception-tenant-9')
    expect(lastInput('IndexFaces')?.ExternalImageId).toBe('visitor-7')
    expect(r).toEqual({ faceId: 'face-abc', confidence: 99 })
  })

  test('searchFacesByImage は visitorId フィールドで一致を返す（戻り値形の互換）', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'CreateCollection') return Promise.resolve({})
      if (cmd._t === 'SearchFacesByImage') {
        return Promise.resolve({
          FaceMatches: [{ Face: { FaceId: 'f1', ExternalImageId: 'visitor-7' }, Similarity: 97 }],
        })
      }
      return Promise.resolve({})
    })

    const r = await searchFacesByImage('tenant-9', Buffer.from('img'), 80)

    expect(lastInput('SearchFacesByImage')?.CollectionId).toBe('reception-tenant-9')
    expect(lastInput('SearchFacesByImage')?.FaceMatchThreshold).toBe(80)
    expect(r).toEqual({ matched: true, faceId: 'f1', visitorId: 'visitor-7', confidence: 97 })
  })

  test('searchFacesByImage は顔なし（InvalidParameterException）で matched:false', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'CreateCollection') return Promise.resolve({})
      if (cmd._t === 'SearchFacesByImage') {
        return Promise.reject(Object.assign(new Error('no face'), { name: 'InvalidParameterException' }))
      }
      return Promise.resolve({})
    })

    const r = await searchFacesByImage('tenant-9', Buffer.from('img'))
    expect(r).toEqual({ matched: false, faceId: null, visitorId: null, confidence: 0 })
  })

  test('deleteFace は reception-<tenant> から削除', async () => {
    await deleteFace('tenant-9', 'face-abc')
    expect(lastInput('DeleteFaces')?.CollectionId).toBe('reception-tenant-9')
    expect(lastInput('DeleteFaces')?.FaceIds).toEqual(['face-abc'])
  })
})

describe('コア層: コレクション名を素通し（従業員/来訪者分離）', () => {
  test('従業員コレクションへ登録', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'IndexFaces') return Promise.resolve({ FaceRecords: [{ Face: { FaceId: 'e1', Confidence: 98 } }] })
      return Promise.resolve({})
    })
    await indexFaceInCollection(employeeCollectionId('store-1'), 'emp-3', Buffer.from('img'))
    expect(lastInput('IndexFaces')?.CollectionId).toBe('baggage-emp-store-1')
    expect(lastInput('IndexFaces')?.ExternalImageId).toBe('emp-3')
  })

  test('来訪者当日コレクションを検索し externalId を返す', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'SearchFacesByImage') {
        return Promise.resolve({ FaceMatches: [{ Face: { FaceId: 'f9', ExternalImageId: 'sess-1' }, Similarity: 95 }] })
      }
      return Promise.resolve({})
    })
    const r = await searchFaceInCollection(visitorDailyCollectionId('store-1', '20260718'), Buffer.from('img'))
    expect(lastInput('SearchFacesByImage')?.CollectionId).toBe('baggage-store-1-20260718')
    expect(r).toEqual({ matched: true, faceId: 'f9', externalId: 'sess-1', confidence: 95 })
  })

  test('ensureCollectionById は ResourceAlreadyExists を無視', async () => {
    sendMock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('exists'), { name: 'ResourceAlreadyExistsException' })),
    )
    await expect(ensureCollectionById('baggage-emp-store-1')).resolves.toBeUndefined()
  })

  test('deleteFaceInCollection は指定コレクションから削除', async () => {
    await deleteFaceInCollection(employeeCollectionId('store-1'), 'e1')
    expect(lastInput('DeleteFaces')?.CollectionId).toBe('baggage-emp-store-1')
  })
})
