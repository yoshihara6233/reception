/**
 * Rekognition コア層の契約テスト（M2）
 *
 * AWS SDK をモックし、送信された Command の CollectionId / ExternalImageId を検証する
 * （実 AWS を叩かない・CIで常時緑）。
 *
 * 検証点:
 *   (1) コレクション名ビルダーが従業員（店舗単位・常設）と来訪者（店舗×日・日次削除）を分離する
 *   (2) コア層がコレクション名を素通しして index/search/delete/deleteCollection する
 *   (3) 顔なし・コレクション既存・コレクション無しの各例外を握って安全側に倒す
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
    CreateCollectionCommand:   class extends Cmd { _t = 'CreateCollection' },
    IndexFacesCommand:         class extends Cmd { _t = 'IndexFaces' },
    SearchFacesByImageCommand: class extends Cmd { _t = 'SearchFacesByImage' },
    DeleteFacesCommand:        class extends Cmd { _t = 'DeleteFaces' },
    DeleteCollectionCommand:   class extends Cmd { _t = 'DeleteCollection' },
  }
})

import {
  employeeCollectionId,
  visitorDailyCollectionId,
  ensureCollectionById,
  indexFaceInCollection,
  searchFaceInCollection,
  deleteFaceInCollection,
  deleteCollectionById,
} from './rekognition'

type SentCmd = { _t: string; input: Record<string, unknown> }

/** 送信された Command のうち種別 t のものの input を返す（最後の1件）。 */
function lastInput(t: string): Record<string, unknown> | undefined {
  const calls = sendMock.mock.calls as unknown as [SentCmd][]
  const hit = [...calls].reverse().find(([c]) => c._t === t)
  return hit?.[0].input
}

beforeEach(() => {
  sendMock.mockReset()
  process.env.AWS_REGION = 'ap-northeast-1'
  process.env.AWS_ACCESS_KEY_ID = 'test'
  process.env.AWS_SECRET_ACCESS_KEY = 'test'
  // 既定: すべて成功。各テストで上書き。
  sendMock.mockImplementation(() => Promise.resolve({}))
})

describe('コレクション名ビルダー', () => {
  test('従業員コレクションは店舗単位で分離', () => {
    expect(employeeCollectionId('store-1')).toBe('baggage-emp-store-1')
    // UUID 中のハイフンは許容・その他はハイフンへ
    expect(employeeCollectionId('abc.def')).toBe('baggage-emp-abc-def')
  })
  test('来訪者コレクションは店舗×日で分離', () => {
    expect(visitorDailyCollectionId('store-1', '20260719')).toBe('baggage-store-1-20260719')
  })
})

describe('コア層: コレクション名を素通し（従業員/来訪者分離）', () => {
  test('従業員コレクションへ登録し FaceId を返す', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'IndexFaces') return Promise.resolve({ FaceRecords: [{ Face: { FaceId: 'e1', Confidence: 98 } }] })
      return Promise.resolve({})
    })
    const r = await indexFaceInCollection(employeeCollectionId('store-1'), 'emp-3', Buffer.from('img'))
    expect(lastInput('IndexFaces')?.CollectionId).toBe('baggage-emp-store-1')
    expect(lastInput('IndexFaces')?.ExternalImageId).toBe('emp-3')
    expect(r).toEqual({ faceId: 'e1', confidence: 98 })
  })

  test('顔が検出できない画像の登録はエラー', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'IndexFaces') return Promise.resolve({ FaceRecords: [] })
      return Promise.resolve({})
    })
    await expect(indexFaceInCollection('baggage-emp-s', 'emp-1', Buffer.from('img')))
      .rejects.toThrow('Face not detected')
  })

  test('来訪者当日コレクションを検索し externalId を返す', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'SearchFacesByImage') {
        return Promise.resolve({ FaceMatches: [{ Face: { FaceId: 'f9', ExternalImageId: 'sess-1' }, Similarity: 95 }] })
      }
      return Promise.resolve({})
    })
    const r = await searchFaceInCollection(visitorDailyCollectionId('store-1', '20260719'), Buffer.from('img'))
    expect(lastInput('SearchFacesByImage')?.CollectionId).toBe('baggage-store-1-20260719')
    expect(r).toEqual({ matched: true, faceId: 'f9', externalId: 'sess-1', confidence: 95 })
  })

  test('検索の threshold は引数で指定（既定72）', async () => {
    await searchFaceInCollection('baggage-emp-s', Buffer.from('img'))
    expect(lastInput('SearchFacesByImage')?.FaceMatchThreshold).toBe(72)
    await searchFaceInCollection('baggage-emp-s', Buffer.from('img'), 90)
    expect(lastInput('SearchFacesByImage')?.FaceMatchThreshold).toBe(90)
  })

  test('顔なし（InvalidParameterException）は matched:false で安全側', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'SearchFacesByImage') {
        return Promise.reject(Object.assign(new Error('no face'), { name: 'InvalidParameterException' }))
      }
      return Promise.resolve({})
    })
    const r = await searchFaceInCollection('baggage-emp-s', Buffer.from('img'))
    expect(r).toEqual({ matched: false, faceId: null, externalId: null, confidence: 0 })
  })

  test('一致なし（FaceMatches 空）も matched:false', async () => {
    sendMock.mockImplementation((cmd: SentCmd) => {
      if (cmd._t === 'SearchFacesByImage') return Promise.resolve({ FaceMatches: [] })
      return Promise.resolve({})
    })
    const r = await searchFaceInCollection('baggage-emp-s', Buffer.from('img'))
    expect(r.matched).toBe(false)
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
    expect(lastInput('DeleteFaces')?.FaceIds).toEqual(['e1'])
  })

  test('deleteCollectionById は当日コレクションを削除・無ければ無視（M6 日次バッチ用）', async () => {
    await deleteCollectionById(visitorDailyCollectionId('store-1', '20260718'))
    expect(lastInput('DeleteCollection')?.CollectionId).toBe('baggage-store-1-20260718')

    sendMock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('gone'), { name: 'ResourceNotFoundException' })),
    )
    await expect(deleteCollectionById('baggage-store-1-20260717')).resolves.toBeUndefined()
  })

  test('AWS 認証情報未設定は明示エラー', async () => {
    delete process.env.AWS_REGION
    await expect(ensureCollectionById('baggage-emp-s')).rejects.toThrow('AWS credentials not configured')
  })
})
