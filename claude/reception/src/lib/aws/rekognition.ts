/**
 * AWS Rekognition wrapper
 *
 * 設計方針:
 * - テナントごとに1つの Collection（`reception-{tenantId}`）
 * - ExternalImageId = visitorId で顔とvisitorを紐付け
 * - 全操作はサーバーサイドのみ（クライアントへ AWS 認証情報を渡さない）
 *
 * 環境変数:
 *   AWS_REGION         — us-east-1 等
 *   AWS_ACCESS_KEY_ID  — IAM ユーザーの Access Key
 *   AWS_SECRET_ACCESS_KEY — IAM ユーザーの Secret Key
 *
 * 必要な IAM パーミッション:
 *   rekognition:CreateCollection
 *   rekognition:IndexFaces
 *   rekognition:SearchFacesByImage
 *   rekognition:DeleteFaces
 */

import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
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

// ── Collection 管理 ────────────────────────────────────────────────────────────

function collectionId(tenantId: string): string {
  // AWS Collection ID: 英数字・ハイフン・アンダースコアのみ
  return `reception-${tenantId.replace(/[^a-zA-Z0-9-_]/g, '-')}`
}

/**
 * Collection を存在確認し、なければ作成する。
 * ResourceAlreadyExistsException は無視する。
 */
export async function ensureCollection(tenantId: string): Promise<void> {
  const client = getClient()
  try {
    await client.send(new CreateCollectionCommand({ CollectionId: collectionId(tenantId) }))
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    if (name !== 'ResourceAlreadyExistsException') throw err
  }
}

// ── 顔登録 ────────────────────────────────────────────────────────────────────

export interface IndexFaceResult {
  faceId: string
  confidence: number
}

/**
 * 顔写真を Collection に登録し、FaceId を返す。
 *
 * @param tenantId    テナントID
 * @param visitorId   訪問者ID (ExternalImageId として保存)
 * @param imageBuffer 顔写真のバイナリ (JPEG/PNG)
 */
export async function indexFace(
  tenantId: string,
  visitorId: string,
  imageBuffer: Buffer,
): Promise<IndexFaceResult> {
  await ensureCollection(tenantId)
  const client = getClient()

  const resp = await client.send(new IndexFacesCommand({
    CollectionId:       collectionId(tenantId),
    Image:              { Bytes: imageBuffer },
    ExternalImageId:    visitorId,
    DetectionAttributes: [],
    MaxFaces:           1,
    QualityFilter:      'AUTO',
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

// ── 顔認証 (検索) ──────────────────────────────────────────────────────────────

export interface SearchFaceResult {
  matched:    boolean
  faceId:     string | null
  visitorId:  string | null
  confidence: number
}

/**
 * 顔写真で Collection を検索し、最も類似度の高い訪問者を返す。
 *
 * @param tenantId        テナントID
 * @param imageBuffer     検索用顔写真のバイナリ
 * @param threshold       最低類似度 (0-100, デフォルト 80)
 */
export async function searchFacesByImage(
  tenantId: string,
  imageBuffer: Buffer,
  threshold = 80,
): Promise<SearchFaceResult> {
  await ensureCollection(tenantId)
  const client = getClient()

  let resp
  try {
    resp = await client.send(new SearchFacesByImageCommand({
      CollectionId:       collectionId(tenantId),
      Image:              { Bytes: imageBuffer },
      MaxFaces:           1,
      FaceMatchThreshold: threshold,
    }))
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    // 顔が検出されなかった (画像に顔がない)
    if (name === 'InvalidParameterException') {
      return { matched: false, faceId: null, visitorId: null, confidence: 0 }
    }
    throw err
  }

  const match = resp.FaceMatches?.[0]
  if (!match?.Face?.FaceId || !match?.Face?.ExternalImageId) {
    return { matched: false, faceId: null, visitorId: null, confidence: 0 }
  }

  return {
    matched:    true,
    faceId:     match.Face.FaceId,
    visitorId:  match.Face.ExternalImageId,   // visitorId として保存していた値
    confidence: match.Similarity ?? 0,
  }
}

// ── 顔削除 ────────────────────────────────────────────────────────────────────

/**
 * 訪問者の顔データを Rekognition Collection から削除する。
 * GDPR/個人情報保護法の「削除権」対応。
 */
export async function deleteFace(tenantId: string, faceId: string): Promise<void> {
  const client = getClient()
  await client.send(new DeleteFacesCommand({
    CollectionId: collectionId(tenantId),
    FaceIds:      [faceId],
  }))
}
