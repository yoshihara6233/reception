/**
 * AWS Rekognition ラッパ（手荷物検査モジュール・M2）
 *
 * 設計方針:
 * - コレクション名を引数化した「コア層」に登録/照合/削除/存在確認を集約する。
 *   従業員 = 店舗毎の常設コレクション / 来訪者 = 店舗×日の当日コレクション（日次バッチで削除）。
 * - ExternalImageId = 呼び出し側の識別子（従業員=employees.id / 来訪者=セッションID 等）。
 * - 全操作はサーバーサイドのみ（クライアントへ AWS 認証情報を渡さない）。
 * - 応答が FACE_AUTH_TIMEOUT_SEC を超える場合の自動スキップは呼び出し側（キオスクAPI）が
 *   Promise.race で行う — ここでは行わない。
 *
 * 環境変数:
 *   AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 *
 * 必要な IAM パーミッション:
 *   rekognition:CreateCollection / IndexFaces / SearchFacesByImage / DeleteFaces / DeleteCollection
 */

import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
  DeleteCollectionCommand,
  type FaceRecord,
} from '@aws-sdk/client-rekognition'

// ── クライアント ──────────────────────────────────────────────────────────────

function getClient(): RekognitionClient {
  const region = process.env.AWS_REGION
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)')
  }

  return new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  })
}

// ── コレクション名ビルダー ────────────────────────────────────────────────────
// AWS Collection ID の許容文字は英数字・ハイフン・アンダースコアのみ。

/** 許容外文字をハイフンに落とす（AWS Collection ID 制約）。 */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]/g, '-')
}

/** 店舗毎の常設「従業員」コレクション。 */
export function employeeCollectionId(storeId: string): string {
  return `baggage-emp-${sanitize(storeId)}`
}

/** 店舗×日の「来訪者」当日コレクション（yyyymmdd）。日次バッチ（M6）で削除。 */
export function visitorDailyCollectionId(storeId: string, yyyymmdd: string): string {
  return `baggage-${sanitize(storeId)}-${sanitize(yyyymmdd)}`
}

// ── コア層（コレクション名を明示指定） ────────────────────────────────────────

export interface IndexFaceResult {
  faceId: string
  confidence: number
}

export interface SearchFaceResult {
  matched: boolean
  faceId: string | null
  /** ExternalImageId として登録していた値（employees.id / セッションID 等）。 */
  externalId: string | null
  confidence: number
}

/** コレクションを存在確認し、なければ作成する（既存は無視）。 */
export async function ensureCollectionById(collectionId: string): Promise<void> {
  const client = getClient()
  try {
    await client.send(new CreateCollectionCommand({ CollectionId: collectionId }))
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    if (name !== 'ResourceAlreadyExistsException') throw err
  }
}

/** 顔写真をコレクションに登録し FaceId を返す。ExternalImageId に externalId を保存。 */
export async function indexFaceInCollection(
  collectionId: string,
  externalId: string,
  imageBuffer: Buffer,
): Promise<IndexFaceResult> {
  await ensureCollectionById(collectionId)
  const client = getClient()

  const resp = await client.send(new IndexFacesCommand({
    CollectionId:        collectionId,
    Image:               { Bytes: imageBuffer },
    ExternalImageId:     externalId,
    DetectionAttributes: [],
    MaxFaces:            1,
    QualityFilter:       'AUTO',
  }))

  const record: FaceRecord | undefined = resp.FaceRecords?.[0]
  if (!record?.Face?.FaceId) {
    throw new Error('Face not detected in image')
  }

  return {
    faceId:     record.Face.FaceId,
    confidence: record.Face.Confidence ?? 0,
  }
}

/**
 * 顔写真でコレクションを検索し、最も類似度の高い ExternalImageId を返す。
 * 既定閾値 72: 登録済みでも実運用（角度・照明差）で 80 未満になり一致しない事例が
 * あったため引き下げ。72 は本人一致の実用域（誤一致は別人写真の目視で担保）。
 */
export async function searchFaceInCollection(
  collectionId: string,
  imageBuffer: Buffer,
  threshold = 72,
): Promise<SearchFaceResult> {
  // 検索側では CreateCollection を呼ばない（コレクションは登録時に作られる前提）。
  // 毎回 CreateCollection すると 3秒レースを容易に超えて認証省略になるため。
  const client = getClient()

  let resp
  try {
    resp = await client.send(new SearchFacesByImageCommand({
      CollectionId:       collectionId,
      Image:              { Bytes: imageBuffer },
      MaxFaces:           1,
      FaceMatchThreshold: threshold,
    }))
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    // 顔が検出されなかった（画像に顔がない）／コレクション未作成（誰も未登録）は一致なし。
    if (name === 'InvalidParameterException' || name === 'ResourceNotFoundException') {
      return { matched: false, faceId: null, externalId: null, confidence: 0 }
    }
    throw err
  }

  const match = resp.FaceMatches?.[0]
  if (!match?.Face?.FaceId || !match?.Face?.ExternalImageId) {
    return { matched: false, faceId: null, externalId: null, confidence: 0 }
  }

  return {
    matched:    true,
    faceId:     match.Face.FaceId,
    externalId: match.Face.ExternalImageId,
    confidence: match.Similarity ?? 0,
  }
}

/** 指定コレクションから顔データを削除する（従業員削除・顔再登録時）。 */
export async function deleteFaceInCollection(collectionId: string, faceId: string): Promise<void> {
  const client = getClient()
  await client.send(new DeleteFacesCommand({
    CollectionId: collectionId,
    FaceIds:      [faceId],
  }))
}

/**
 * コレクションごと削除する（来訪者の当日コレクションを日次バッチ M6 で削除）。
 * 既に無い（ResourceNotFoundException）場合は無視する。
 */
export async function deleteCollectionById(collectionId: string): Promise<void> {
  const client = getClient()
  try {
    await client.send(new DeleteCollectionCommand({ CollectionId: collectionId }))
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    if (name !== 'ResourceNotFoundException') throw err
  }
}
