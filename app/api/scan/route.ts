import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getConfig, setLastScanTime } from '@/lib/supabase'
import { runScan } from '@/lib/scanner'
import { sendAlertEmail } from '@/lib/email'
import { sendSmsAlert } from '@/lib/sms'
import { Deal } from '@/lib/types'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('=== Goodwill Hunter scan starting ===')
    const config = await getConfig()
    const deals = await runScan(config)

    if (deals.length === 0) {
      await setLastScanTime()
      if (config.email_when_empty && config.alert_email) {
        await sendAlertEmail([], config.alert_email)
      }
      return NextResponse.json({ message: 'No qualifying deals found', count: 0 })
    }

    // Upsert all deals (url is unique — won't duplicate existing)
    const db = supabaseAdmin()
    const { error } = await db.from('deals').upsert(
      deals.map(d => ({ ...d, updated_at: new Date().toISOString() })),
      { onConflict: 'url', ignoreDuplicates: false }
    )
    if (error) console.error('Supabase upsert error:', error)

    // Fetch unnotified deals that cross the email threshold
    const emailThreshold = config.alert_score_threshold ?? 70
    const { data: emailQueue } = await db
      .from('deals')
      .select('*')
      .in('url', deals.map(d => d.url))
      .eq('notified', false)
      .gte('deal_score', emailThreshold)
      .order('deal_score', { ascending: false })

    const toEmail = (emailQueue ?? []) as Deal[]

    // Fetch unnotified deals that cross the SMS threshold (can be different / higher)
    const smsThreshold = config.sms_score_threshold ?? 75
    const toSms = config.sms_enabled
      ? toEmail.filter(d => d.deal_score >= smsThreshold)
      : []

    // ── Send email alert ──────────────────────────────────────────────────────
    if (toEmail.length > 0 && config.alert_email) {
      await sendAlertEmail(toEmail, config.alert_email)
      console.log(`Email alert sent: ${toEmail.length} deal(s) → ${config.alert_email}`)
    }

    // ── Send SMS alert ────────────────────────────────────────────────────────
    if (toSms.length > 0) {
      const phone = config.alert_phone || process.env.ALERT_PHONE
      await sendSmsAlert(toSms, phone)
      console.log(`SMS alert sent: ${toSms.length} deal(s) → ${phone}`)
    }

    // Mark all emailed deals as notified
    if (toEmail.length > 0) {
      await db
        .from('deals')
        .update({ notified: true })
        .in('id', toEmail.map((d: Deal) => d.id))
    }

    await setLastScanTime()
    console.log(`=== Scan complete: ${deals.length} deals, ${toEmail.length} emailed, ${toSms.length} SMS'd ===`)

    return NextResponse.json({
      message: 'Scan complete',
      count: deals.length,
      emailed: toEmail.length,
      sms_sent: toSms.length,
    })
  } catch (err) {
    console.error('Scan error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
