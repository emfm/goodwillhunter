// app/api/scan/estimate/route.ts
// Phase 2: Load raw items for scan_id, estimate values, update DB
// Runs in batches of 20, max 3 concurrent — typically 30–120s
import { NextRequest, NextResponse } from 'next/server'
import { setScanStatus } from '@/lib/scan-status-store'
import { supabaseAdmin } from '@/lib/supabase'
import { estimateValuesForScan } from '@/lib/scanner'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { scanId } = await req.json()
    if (!scanId) return NextResponse.json({ error: 'scanId required' }, { status: 400 })

    const db = supabaseAdmin()
    const { data: items, error } = await db
      .from('raw_scan_items')
      .select('url,title,current_bid')
      .eq('scan_id', scanId)
      .is('estimated_value', null)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!items?.length) return NextResponse.json({ ok: true, estimated: 0, message: 'Nothing to estimate' })

    await setScanStatus({ phase: 'estimating', message: 'Looking up prices…', detail: `${items.length} items`, progress: 40 })

    const { updates, realPrices, aiPrices } = await estimateValuesForScan(items, scanId)

    // Batch update
    for (const u of updates) {
      await db.from('raw_scan_items').update({ estimated_value: u.value, value_source: u.source }).eq('url', u.url)
    }

    await setScanStatus({ phase: 'analyzing', message: 'Prices looked up', detail: `${realPrices} real comps, ${aiPrices} AI estimates`, progress: 65, realPrices, aiPrices })
    console.log(`[ESTIMATE] Done: ${updates.length} items, ${realPrices} real, ${aiPrices} AI`)
    return NextResponse.json({ ok: true, estimated: updates.length, realPrices, aiPrices })
  } catch (err) {
    await setScanStatus({ phase: 'error', message: 'Estimation failed', detail: String(err), error: String(err), progress: 0 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
