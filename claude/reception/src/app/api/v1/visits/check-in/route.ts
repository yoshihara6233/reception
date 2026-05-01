import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateQrToken } from '@/lib/qr/validate'
import { sendSlackNotification } from '@/lib/notifications/slack'
import { sendEmailNotification } from '@/lib/notifications/email'
import { sendHostNotification } from '@/lib/notifications/host'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, company, name, department, phone, email, purpose, contactPerson, contactPersonId, visitorId: knownVisitorId } = body

    // visitorId が渡された場合は既存 visitor を使う (顔認証チェックイン)
    // それ以外は company / name 必須
    if (!token || (!knownVisitorId && (!company?.trim() || !name?.trim())) || !purpose) {
      return NextResponse.json(
        { error: '必須項目が入力されていません' },
        { status: 400 }
      )
    }

    // Validate QR token
    const qr = await validateQrToken(token)
    if (!qr.valid) {
      return NextResponse.json(
        { error: qr.error },
        { status: 403 }
      )
    }

    const supabase = createAdminClient()

    // Check for duplicate check-in (visitor already checked in at this area)
    // Use device_token from request header if available
    const deviceToken = req.headers.get('x-device-token')

    if (deviceToken) {
      const { data: existingVisit } = await supabase
        .from('visits')
        .select('id')
        .eq('area_id', qr.areaId!)
        .eq('status', 'checked_in')
        .eq('visitor_id', (
          await supabase
            .from('visitors')
            .select('id')
            .eq('device_token', deviceToken)
            .eq('tenant_id', qr.tenantId!)
            .limit(1)
            .single()
        ).data?.id || '00000000-0000-0000-0000-000000000000')
        .limit(1)
        .maybeSingle()

      if (existingVisit) {
        return NextResponse.json(
          { error: '既に入室中です。退室してから再度入室してください。', visitId: existingVisit.id },
          { status: 409 }
        )
      }
    }

    // Create or update visitor
    // knownVisitorId が渡された場合 (顔認証チェックイン) は既存 visitor をそのまま使う
    let visitorDbId: string

    if (knownVisitorId) {
      // 顔認証で特定済みの visitor を使う (新規作成しない)
      const { data: existingVisitor, error: fetchErr } = await supabase
        .from('visitors')
        .select('id')
        .eq('id', knownVisitorId)
        .eq('tenant_id', qr.tenantId!)
        .single()

      if (fetchErr || !existingVisitor) {
        return NextResponse.json(
          { error: '来訪者が見つかりません' },
          { status: 404 }
        )
      }
      visitorDbId = existingVisitor.id
    } else {
      const { data: visitor, error: visitorError } = await supabase
        .from('visitors')
        .upsert(
          {
            tenant_id: qr.tenantId!,
            company: company.trim(),
            department: department?.trim() || null,
            name: name.trim(),
            phone: phone?.trim() || null,
            email: email?.trim() || null,
            device_token: deviceToken || null,
          },
          {
            onConflict: 'id', // won't match, always inserts. TODO: upsert by device_token
          }
        )
        .select('id')
        .single()

      if (visitorError || !visitor) {
        console.error('Visitor creation error:', visitorError)
        return NextResponse.json(
          { error: '来訪者情報の登録に失敗しました' },
          { status: 500 }
        )
      }
      visitorDbId = visitor.id
    }

    // Create visit
    const { data: visit, error: visitError } = await supabase
      .from('visits')
      .insert({
        tenant_id: qr.tenantId!,
        visitor_id: visitorDbId,
        store_id: qr.storeId!,
        area_id: qr.areaId!,
        purpose,
        status: 'checked_in',
      })
      .select('id')
      .single()

    if (visitError || !visit) {
      console.error('Visit creation error:', visitError)
      return NextResponse.json(
        { error: 'チェックインに失敗しました' },
        { status: 500 }
      )
    }

    // Fire-and-forget: dispatch notifications for check-in event
    void (async () => {
      try {
        // Get store name for notification message
        const { data: storeData } = await supabase
          .from('stores')
          .select('name')
          .eq('id', qr.storeId!)
          .single()
        const storeName = storeData?.name || qr.storeId || 'unknown'
        const displayName    = name?.trim()    || ''
        const displayCompany = company?.trim() || ''
        const message = displayCompany
          ? `✅ [${displayName} / ${displayCompany}] が [${storeName}] にチェックインしました`
          : `✅ [${displayName}] が [${storeName}] にチェックインしました`

        // Get notification rules for this tenant + store
        const { data: rules } = await supabase
          .from('notification_rules')
          .select('*')
          .eq('tenant_id', qr.tenantId!)
          .eq('event_type', 'checkin')
          .eq('enabled', true)

        for (const rule of rules ?? []) {
          // Match store filter (null store_id means all stores)
          if (rule.store_id && rule.store_id !== qr.storeId) continue

          if (rule.channel === 'slack' && rule.config?.webhookUrl) {
            sendSlackNotification(rule.config.webhookUrl, message)
          } else if (rule.channel === 'email' && rule.config?.email) {
            sendEmailNotification(
              rule.config.email,
              'チェックイン通知',
              `<p>${message}</p>`
            )
          }
        }

        // Host notification — notify the specific contact person
        if (contactPersonId) {
          const { data: staffMember } = await supabase
            .from('staff_members')
            .select('id, name, email, slack_member_id')
            .eq('id', contactPersonId)
            .eq('tenant_id', qr.tenantId!)
            .eq('is_active', true)
            .maybeSingle()

          if (staffMember) {
            // Get Slack webhook for this tenant (use first enabled checkin rule)
            const { data: slackRule } = await supabase
              .from('notification_rules')
              .select('config')
              .eq('tenant_id', qr.tenantId!)
              .eq('channel', 'slack')
              .eq('event_type', 'checkin')
              .eq('enabled', true)
              .maybeSingle()

            sendHostNotification(
              staffMember,
              {
                visitor_name: name.trim(),
                company: company.trim(),
                purpose,
                store_name: storeName,
                check_in_at: new Date().toISOString(),
              },
              slackRule?.config?.webhookUrl ?? null
            ).catch(e => console.error('[host-notify] error:', e))
          }
        }

        // Dispatch webhooks
        const { data: webhookEndpoints } = await supabase
          .from('webhook_endpoints')
          .select('id, url, secret, events')
          .eq('tenant_id', qr.tenantId!)
          .eq('enabled', true)
          .contains('events', ['checkin'])

        for (const endpoint of webhookEndpoints ?? []) {
          const webhookPayload = {
            visitor_name: name.trim(),
            company: company.trim(),
            store_id: qr.storeId,
            store_name: storeName,
            visit_id: visit.id,
          }
          const result = await dispatchWebhook(
            endpoint.url,
            endpoint.secret,
            'checkin',
            webhookPayload
          )
          // Record delivery
          await supabase.from('webhook_deliveries').insert({
            endpoint_id: endpoint.id,
            event_type: 'checkin',
            payload: webhookPayload,
            status: result.success ? 'delivered' : 'failed',
            http_status: result.httpStatus ?? null,
            duration_ms: result.durationMs,
          })
        }
      } catch (err) {
        console.error('[notifications] error dispatching check-in notifications:', err)
      }
    })()

    return NextResponse.json({
      visitId: visit.id,
      visitorId: visitorDbId,
      tenantId: qr.tenantId,
    })
  } catch (err) {
    console.error('Check-in error:', err)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
