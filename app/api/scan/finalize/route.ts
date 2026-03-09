// app/api/scan/finalize/route.ts
// Phase 3: Analyze top images + score everything + upsert to deals table
import { NextRequest, NextResponse } from 'next/server'
import { setScanStatus } from '@/lib/scan-status-store'
import { supabaseAdmin, getConfig, setLastScanTime } from '@/lib/supabase'
import { finalizeDeals } from '@/lib/scanner'
import { sendAlertEmail } from '@/lib/email'
import { sendSmsAlert } from '@/lib/sms'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const BASE_COLUMNS = new Set([
  'title','current_bid','estimated_value','adjusted_value','deal_score',
  'url','image_url','source','end_time','time_remaining','num_bids',
  'category','matched_keyword','value_source','condition','condition_score',
  'completeness','is_authentic','value_multiplier','flags','positives',
  'img_summary','updated_at','match_type','description','starred','first_seen_at','scan_id',
])

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { scanId } = await req.json()
    if (!scanId) return NextResponse.json({ error: 'scanId required' }, { status: 400 })

    const config = await getConfig()
    await setScanStatus({ phase: 'analyzing', message: 'Analyzing top photos…', detail: 'Selecting best candidates', progress: 65 })

    const deals = await finalizeDeals(scanId, config)
    if (!deals.length) {
      await setScanStatus({ phase: 'done', message: 'Scan complete', detail: 'No deals met the score threshold', progress: 100, finishedAt: new Date().toISOString(), scanId })
      return NextResponse.json({ ok: true, stored: 0 })
    }

    await setScanStatus({ phase: 'storing', message: 'Saving deals…', detail: `${deals.length} deals`, progress: 92 })

    const db = supabaseAdmin()
    const rows = (deals as Record<string, unknown>[]).map(d => {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const [k, v] of Object.entries(d)) {
        if (BASE_COLUMNS.has(k)) row[k] = v
      }
      return row
    })

    const { error: upsertErr } = await db.from('deals').upsert(rows as any, { onConflict: 'url', ignoreDuplicates: false })
    if (upsertErr) console.error('[FINALIZE] upsert error:', upsertErr.message)

    // Clean up raw items
    await db.from('raw_scan_items').delete().eq('scan_id', scanId)

    await setLastScanTime()

    // Alerts
    const alertScore = config.alert_score_threshold ?? 70
    const hotDeals = deals.filter(d => (d as any).deal_score >= alertScore)
    if (hotDeals.length && config.alert_email) {
      await (sendAlertEmail as any)(hotDeals, config.alert_email).catch(() => {})
    }
    if (hotDeals.length && config.sms_enabled && config.alert_phone) {
      for (const d of hotDeals.slice(0, 3)) {
        await (sendSmsAlert as any)(d, config.alert_phone).catch(() => {})
      }
    }

    const withImg = deals.filter((d: any) => d.img_summary).length
    await setScanStatus({ phase: 'done', message: 'Scan complete! 🎯', detail: `${deals.length} deals stored (${withImg} with photos)`, progress: 100, finishedAt: new Date().toISOString(), scanId })
    console.log(`[FINALIZE] Done: ${deals.length} deals stored`)
    return NextResponse.json({ ok: true, stored: deals.length, scanId })
  } catch (err) {
    await setScanStatus({ phase: 'error', message: 'Finalize failed', detail: String(err), error: String(err), progress: 0 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
