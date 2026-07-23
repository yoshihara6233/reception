/**
 * F47: NVR 接続テスト API (Admin 配下)
 *
 * POST /api/admin/stores/[id]/nvr/test-connection
 *
 * Phase 0 はモック応答 — Phase 1 で edge-agent への RPC ブリッジに置換。
 * 旧 /api/stores/[id]/nvr/test-connection から移設。
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'

interface RequestBody {
  vendor:   string
  endpoint: string
  options:  Record<string, unknown>
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // 認可: admin ロール＋対象店舗が可視（＝自テナント）であること。middleware は
  // /api/** を認証ゲートしないため、ここで明示的に確認する（Phase1 で実接続に置換時の SSRF 予防）。
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.error }, { status: guard.status })
  const { data: store } = await guard.supa.from('stores').select('id').eq('id', id).maybeSingle()
  if (!store) return NextResponse.json({ ok: false, message: 'store_not_visible' }, { status: 404 })

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  if (!body.vendor || !body.endpoint) {
    return NextResponse.json(
      { ok: false, message: 'vendor と endpoint は必須です' },
      { status: 400 },
    )
  }

  // Phase 0: モック応答 (Phase 1 で edge-agent 経由の実 testConnection に置換)
  await new Promise((r) => setTimeout(r, 800))

  if (body.endpoint.includes('invalid') || body.endpoint.includes('unreachable')) {
    return NextResponse.json({
      ok:      false,
      message: `Connection refused or timeout: ${body.endpoint}`,
    })
  }

  const mockData = mockResponseFor(body.vendor)
  return NextResponse.json({
    ok:           true,
    vendor:       body.vendor,
    modelNumber:  mockData.modelNumber,
    fwVersion:    mockData.fwVersion,
    capabilities: mockData.capabilities,
    storeId:      id,
  })
}

function mockResponseFor(vendor: string): {
  modelNumber: string; fwVersion: string; capabilities: Record<string, unknown>
} {
  if (vendor === 'i-pro-nx') {
    return {
      modelNumber: 'WJ-NX300K',
      fwVersion:   '3.42-0001 (mock)',
      capabilities: {
        supportsSnapshot: true, supportsLiveRtsp: true, supportsVod: true,
        maxResolution: '4K', maxChannels: 32,
      },
    }
  }
  if (vendor === 'i-pro-nu') {
    return {
      modelNumber: 'WJ-NU201K',
      fwVersion:   '3.10-0001 (mock)',
      capabilities: {
        supportsSnapshot: true, supportsLiveRtsp: true, supportsVod: true,
        maxResolution: '4K', maxChannels: 8,
      },
    }
  }
  if (vendor === 'i-pro-gxe500') {
    return {
      modelNumber: 'WJ-GXE500',
      fwVersion:   '1.10-0001 (mock)',
      capabilities: {
        supportsSnapshot: true, supportsLiveRtsp: true, supportsVod: false,
        maxResolution: '1080p', maxChannels: 4,
      },
    }
  }
  if (vendor === 'frigate') {
    return {
      modelNumber: 'frigate-docker',
      fwVersion:   '0.13.x (mock)',
      capabilities: {
        supportsSnapshot: true, supportsLiveRtsp: true, supportsVod: true,
        maxResolution: '4K', maxChannels: 16,
      },
    }
  }
  return {
    modelNumber: 'UNKNOWN',
    fwVersion:   '0.0.0',
    capabilities: {},
  }
}
