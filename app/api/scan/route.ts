import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getConfig, setLastScanTime } from '@/lib/supabase'
import { runScan } from '@/lib/scanner'
import { sendAlertEmail } from '@/lib/email'
import { sendSmsAlert } from '@/lib/sms'
import { Deal } from '@/lib/types'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// Columns that exist in the base schema (before migration.sql)
const BASE_COLUMNS = new Set([
  'title','current_bid','estimated_value','adjusted_value','deal_score',
  'url','image_url','source','end_time','time_remaining','num_bids',
  'category','matched_keyword','value_source','condition','condition_score',
  'completeness','is_authentic','value_multiplier','flags','positives',
  'img_summary','updated_at',
])
// Columns added by migration.sql — safe to include once migration has run
const MIGRATION_COLUMNS = new Set(['match_type','description'])

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

    // ── Config ───────────────────────────────────────────────────────────────
    const config = await getConfig()
    console.log(`[ROUTE] sources  : ${config.sources.join(', ')}`)
    console.log(`[ROUTE] keywords : ${config.keywords.length} — ${config.keywords.slice(0,5).join(', ')}${config.keywords.length > 5 ? '…' : ''}`)
    console.log(`[ROUTE] maxPrice : $${config.max_search_price} | pages/kw: ${config.pages_per_keyword}`)

    // ── Keyword overrides from UI ────────────────────────────────────────────
    let body: { keywords?: string[] } = {}
    try { body = await req.json() } catch { /* no body = fine */ }
    if (body.keywords?.length) {
      console.log(`[ROUTE] ⚡ Keyword overrides: ${body.keywords.join(', ')}`)
      config.keywords = body.keywords
    }

    // ── Scan ─────────────────────────────────────────────────────────────────
    console.log('[ROUTE] Calling runScan...')
    const deals = await runScan(config)
    console.log(`[ROUTE] runScan returned ${deals.length} deals`)

    if (deals.length === 0) {
      console.log('[ROUTE] ⚠ Zero deals — nothing to store')
      await setLastScanTime()
      return NextResponse.json({ message: 'No items found', count: 0 })
    }

    // ── Probe DB schema ───────────────────────────────────────────────────────
    // Try to detect if migration columns exist by probing one row.
    const db = supabaseAdmin()
    const { data: probe, error: probeErr } = await db
      .from('deals').select('match_type').limit(1)
    const migrationDone = !probeErr
    console.log(`[ROUTE] migration.sql applied: ${migrationDone} ${probeErr ? `(${probeErr.message})` : ''}`)

    // Strip columns that don't exist yet
    const rows = deals.map(d => {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const [k, v] of Object.entries(d)) {
        if (BASE_COLUMNS.has(k)) { row[k] = v; continue }
        if (MIGRATION_COLUMNS.has(k) && migrationDone) { row[k] = v; continue }
        // skip unknown columns silently
      }
      return row
    })

    // Deduplicate by URL — same item can match multiple keywords
    const seenUrls = new Set<string>()
    const dedupedRows = rows.filter(r => {
      const url = r.url as string
      if (seenUrls.has(url)) return false
      seenUrls.add(url)
      return true
    })
    console.log(`[ROUTE] Upserting ${dedupedRows.length} rows (${rows.length - dedupedRows.length} dupes removed, migration: ${migrationDone ? 'yes' : 'no'})`)
    console.log(`[ROUTE] Sample: "${dedupedRows[0]?.title}" | ${dedupedRows[0]?.source} | $${dedupedRows[0]?.current_bid}`)

    const { error: upsertErr } = await db
      .from('deals')
      .upsert(dedupedRows as any, { onConflict: 'url', ignoreDuplicates: false })

    if (upsertErr) {
      console.error('[ROUTE] ❌ UPSERT FAILED:', JSON.stringify(upsertErr))
      // Don't give up — log and continue so we still set lastScanTime
    } else {
      console.log(`[ROUTE] ✅ Upsert OK`)
    }

    // ── Confirm row count ────────────────────────────────────────────────────
    const { count: dbCount } = await db
      .from('deals').select('*', { count: 'exact', head: true })
    console.log(`[ROUTE] ✅ Total rows in deals table: ${dbCount ?? 'unknown'}`)

    // ── Alerts ───────────────────────────────────────────────────────────────
    const emailThreshold = config.alert_score_threshold ?? 70
    const { data: emailQueue } = await db
      .from('deals').select('*')
      .in('url', deals.map(d => d.url))
      .eq('notified', false)
      .gte('deal_score', emailThreshold)
      .order('deal_score', { ascending: false })

    const toEmail = (emailQueue ?? []) as Deal[]
    const toSms = config.sms_enabled
      ? toEmail.filter(d => d.deal_score >= (config.sms_score_threshold ?? 75))
      : []

    if (toEmail.length > 0 && config.alert_email) {
      await sendAlertEmail(toEmail, config.alert_email)
      console.log(`[ROUTE] Email: ${toEmail.length} → ${config.alert_email}`)
    }
    if (toSms.length > 0) {
      await sendSmsAlert(toSms, config.alert_phone || process.env.ALERT_PHONE)
      console.log(`[ROUTE] SMS: ${toSms.length} sent`)
    }
    if (toEmail.length > 0) {
      await db.from('deals').update({ notified: true })
        .in('id', toEmail.map((d: Deal) => d.id))
    }

    await setLastScanTime()

    console.log(`[ROUTE] ══ DONE: ${deals.length} scanned, ${dbCount} in DB, ${toEmail.length} emailed ══`)

    return NextResponse.json({
      message: 'Scan complete',
      count: deals.length,
      db_total: dbCount,
      migration_applied: migrationDone,
      upsert_error: upsertErr?.message ?? null,
      emailed: toEmail.length,
    })

  } catch (err) {
    console.error('[ROUTE] ❌ FATAL:', String(err))
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
