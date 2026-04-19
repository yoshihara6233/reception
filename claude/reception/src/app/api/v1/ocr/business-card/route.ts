import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

export interface OcrResult {
  company: string
  department: string
  name: string
  phone: string
  email: string
  confidence: 'high' | 'medium' | 'low'
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey.startsWith('sk-ant-your-key')) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured', result: null },
      { status: 503 }
    )
  }

  let dataUrl: string
  try {
    const body = await req.json()
    dataUrl = body.dataUrl
    if (!dataUrl?.startsWith('data:image')) {
      return NextResponse.json({ error: 'Invalid image data' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Strip the data URL prefix → get base64 + mediaType
  const [header, base64Data] = dataUrl.split(',')
  const mediaTypeMatch = header.match(/data:(image\/\w+);base64/)
  const mediaType = (mediaTypeMatch?.[1] ?? 'image/jpeg') as
    | 'image/jpeg'
    | 'image/png'
    | 'image/gif'
    | 'image/webp'

  try {
    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            {
              type: 'text',
              text: `これは名刺の画像です。以下の情報を抽出してJSONで返してください。
フィールドが読み取れない場合は空文字を返してください。
電話番号は最も重要なもの（携帯優先）を1つだけ返してください。

必ず以下のJSON形式のみを返してください（他のテキストは不要）:
{
  "company": "会社名",
  "department": "部署名",
  "name": "氏名（フルネーム）",
  "phone": "電話番号",
  "email": "メールアドレス",
  "confidence": "high|medium|low"
}

confidence の判断基準:
- high: 全フィールドが明確に読み取れた
- medium: 一部フィールドが不明瞭または欠損
- low: 画像が不鮮明、または名刺ではない可能性がある`,
            },
          ],
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''

    // Extract JSON from response (Claude sometimes wraps in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse OCR response', result: null }, { status: 500 })
    }

    const result: OcrResult = JSON.parse(jsonMatch[0])
    return NextResponse.json({ result })
  } catch (err: any) {
    console.error('[OCR] Anthropic API error:', err?.message ?? err)
    return NextResponse.json(
      { error: 'OCR processing failed', result: null },
      { status: 500 }
    )
  }
}
