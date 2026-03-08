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
    console.log('\n[ROUTE] ══════════════════════════════════════════')
    console.log('[ROUTE] Goodwill Hunter scan starting')
    console.log('[ROUTE] ══════════════════════════════════════════')

    // ── Load config ──────────────────────────────────────────────────────────
    const config = await getConfig()
    console.log(`[ROUTE] Config loaded`)
    console.log(`[ROUTE]   sources   : ${config.sources.join(', ')}`)
    console.log(`[ROUTE]   keywords  : ${config.keywords.length} keywords`)
    console.log(`[ROUTE]   max price : $${config.max_search_price}`)
    console.log(`[ROUTE]   pages/kw  : ${config.pages_per_keyword}`)

    // ── Keyword overrides from UI ────────────────────────────────────────────
    let body: { keywords?: string[] } = {}
    try { body = await req.json() } catch { /* no body is fine */ }
    if (body.keywords?.length) {
      console.log(`[ROUTE] Keyword overrides (${body.keywords.length}): ${body.keywords.join(', ')}`)
      config.keywords = body.keywords
    }

    // ── Run crawl ────────────────────────────────────────────────────────────
    console.log('[ROUTE] Starting scanner...')
    const deals = await runScan(config)
    console.log(`[ROUTE] Scanner returned ${deals.length} deals`)

    if (deals.length === 0) {
      console.log('[ROUTE] ⚠ Zero deals — skipping upsert')
      await setLastScanTime()
      return NextResponse.json({ message: 'No items found', count: 0 })
    }

    // ── Upsert to DB ─────────────────────────────────────────────────────────
    console.log(`[ROUTE] Upserting ${deals.length} rows to Supabase...`)
    const db = supabaseAdmin()

    const rows = deals.map(d => ({ ...d, updated_at: new Date().toISOString() }))
    console.log(`[ROUTE]   Sample row url   : ${rows[0]?.url}`)
    console.log(`[ROUTE]   Sample row title : ${rows[0]?.title?.slice(0, 60)}`)
    console.log(`[ROUTE]   Sample row source: ${rows[0]?.source}`)

    const { error: upsertError, count } = await db
      .from('deals')
      .upsert(rows, { onConflict: 'url', ignoreDuplicates: false })
      .select('id')  // force count

    if (upsertError) {
      console.error('[ROUTE] ❌ Supabase upsert ERROR:', JSON.stringify(upsertError))
    } else {
      console.log(`[ROUTE] ✅ Upsert OK — ${count ?? '?'} rows affected`)
    }

    // ── Verify rows exist in DB ───────────────────────────────────────────────
    const { count: dbCount, error: countErr } = await db
      .from('deals')
      .select('*', { count: 'exact', head: true })
    if (countErr) {
      console.error('[ROUTE] ❌ Count check error:', countErr.message)
    } else {
      console.log(`[ROUTE] ✅ Total deals in DB now: ${dbCount}`)
    }

    // ── Alerts ───────────────────────────────────────────────────────────────
    const emailThreshold = config.alert_score_threshold ?? 70
    const { data: emailQueue } = await db
      .from('deals')
      .select('*')
      .in('url', deals.map(d => d.url))
      .eq('notified', false)
      .gte('deal_score', emailThreshold)
      .order('deal_score', { ascending: false })

    const toEmail = (emailQueue ?? []) as Deal[]
    console.log(`[ROUTE] Alert queue: ${toEmail.length} deals above threshold ${emailThreshold}`)

    const smsThreshold = config.sms_score_threshold ?? 75
    const toSms = config.sms_enabled ? toEmail.filter(d => d.deal_score >= smsThreshold) : []

    if (toEmail.length > 0 && config.alert_email) {
      await sendAlertEmail(toEmail, config.alert_email)
      console.log(`[ROUTE] Email sent: ${toEmail.length} deals → ${config.alert_email}`)
    }
    if (toSms.length > 0) {
      const phone = config.alert_phone || process.env.ALERT_PHONE
      await sendSmsAlert(toSms, phone)
      console.log(`[ROUTE] SMS sent: ${toSms.length} deals → ${phone}`)
    }
    if (toEmail.length > 0) {
      await db.from('deals').update({ notified: true }).in('id', toEmail.map((d: Deal) => d.id))
    }

    await setLastScanTime()

    console.log('[ROUTE] ══════════════════════════════════════════')
    console.log(`[ROUTE] DONE: ${deals.length} stored, ${toEmail.length} emailed, ${toSms.length} SMS`)
    console.log('[ROUTE] ══════════════════════════════════════════')

    return NextResponse.json({
      message: 'Scan complete',
      count: deals.length,
      db_count: dbCount,
      emailed: toEmail.length,
      sms_sent: toSms.length,
    })
  } catch (err) {
    console.error('[ROUTE] ❌ FATAL scan error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
