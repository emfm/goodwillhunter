// app/api/scan/crawl/route.ts
// Phase 1: Crawl SG + CTBids, store raw items to DB, return scan_id
// Typically 30–90s depending on keyword count
import { NextRequest, NextResponse } from 'next/server'
import { setScanStatus, resetScanStatus } from '@/lib/scan-status-store'
import { supabaseAdmin, getConfig } from '@/lib/supabase'
import { crawlSources } from '@/lib/scanner'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  resetScanStatus()
  await setScanStatus({ phase: 'starting', message: 'Starting crawl…', detail: 'Loading config', progress: 2, startedAt: new Date().toISOString() })

  try {
    const config = await getConfig()
    let body: { keywords?: string[] } = {}
    try { body = await req.json() } catch {}
    if (body.keywords?.length) config.keywords = body.keywords

    const scanId = `scan_${Date.now()}`
    const { items } = await crawlSources(config, scanId)

    // Store raw items to DB
    const db = supabaseAdmin()
    if (items.length > 0) {
      const rows = items.map(i => ({
        scan_id: scanId,
        url: i.url,
        title: i.title,
        current_bid: i.current_bid,
        image_url: i.image_url,
        source: i.source,
        end_time: i.end_time,
        time_remaining: i.time_remaining,
        num_bids: i.num_bids,
        matched_keyword: i.matched_keyword,
        match_type: i.match_type ?? 'text',
      }))
      const { error } = await db.from('raw_scan_items').upsert(rows, { onConflict: 'url' })
      if (error) console.error('[CRAWL] upsert error:', error.message)
    }

    await setScanStatus({ phase: 'estimating', message: 'Crawl complete', detail: `${items.length} items found`, progress: 35, itemsFound: items.length, sgItems: items.filter(i => i.source === 'ShopGoodwill').length, ctItems: items.filter(i => i.source === 'CTBids').length })
    console.log(`[CRAWL] Done: ${items.length} items, scan_id=${scanId}`)
    return NextResponse.json({ ok: true, scanId, count: items.length })
  } catch (err) {
    await setScanStatus({ phase: 'error', message: 'Crawl failed', detail: String(err), error: String(err), progress: 0 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
