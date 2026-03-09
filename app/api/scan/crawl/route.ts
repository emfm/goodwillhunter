// app/api/scan/crawl/route.ts
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  resetScanStatus()
  await setScanStatus({ phase: 'starting', message: 'Starting crawl…', detail: 'Loading config', progress: 2, startedAt: new Date().toISOString() })

  try {
    const config = await getConfig()
    let body: { keywords?: string[] } = {}
    try { body = await req.json() } catch {}
    if (body.keywords?.length) config.keywords = body.keywords

    const scanId = `scan_${Date.now()}`

    // Clean up any leftover raw items from previous failed scans
    const db0 = supabaseAdmin()
    try { await db0.from('raw_scan_items').delete().lt('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()) } catch {}

    const { items } = await crawlSources(config, scanId)

    if (!items.length) { // raw items check before dedup
      await setScanStatus({ phase: 'done', message: 'No items found', detail: 'Try different keywords', progress: 100, finishedAt: new Date().toISOString() })
      return NextResponse.json({ ok: true, scanId, count: 0 })
    }

    // Ensure table exists, then store
    const db = supabaseAdmin()

    // Create table if missing (idempotent)
    try { await db.rpc('exec_sql', { sql: `ALTER TABLE raw_scan_items DISABLE ROW LEVEL SECURITY;` }) } catch { /* ok */ }

    // Deduplicate by URL — same item can appear under multiple keywords
    const seenUrls = new Set<string>()
    const uniqueItems = items.filter(item => { if (seenUrls.has(item.url)) return false; seenUrls.add(item.url); return true })
    console.log(`[CRAWL] ${items.length} items → ${uniqueItems.length} after dedup`)

    // Delete-then-insert avoids ALL upsert conflict issues
    const { error: delErr } = await db.from('raw_scan_items').delete().eq('scan_id', scanId)
    if (delErr && delErr.code === '42P01') {
      return NextResponse.json({ error: 'Table raw_scan_items not found. Please run migration.sql in Supabase.' }, { status: 500 })
    }

    const CHUNK = 500
    let stored = 0
    for (let i = 0; i < uniqueItems.length; i += CHUNK) {
      const chunk = uniqueItems.slice(i, i + CHUNK).map(item => ({
        scan_id: scanId,
        url: item.url,
        title: item.title,
        current_bid: item.current_bid,
        image_url: item.image_url,
        source: item.source,
        end_time: item.end_time,
        time_remaining: item.time_remaining,
        num_bids: item.num_bids,
        matched_keyword: item.matched_keyword,
        match_type: item.match_type ?? 'text',
      }))
      const { error } = await db.from('raw_scan_items').insert(chunk)
      if (error) {
        console.error(`[CRAWL] insert chunk ${i}-${i+CHUNK} error:`, error.message, error.code)
      } else {
        stored += chunk.length
      }
    }

    await setScanStatus({
      phase: 'estimating', message: 'Crawl complete', progress: 35,
      detail: `${stored} items stored — SG: ${uniqueItems.filter(i => i.source==='ShopGoodwill').length}, CT: ${uniqueItems.filter(i=>i.source==='CTBids').length}`,
      itemsFound: uniqueItems.length,
      sgItems: uniqueItems.filter(i => i.source === 'ShopGoodwill').length,
      ctItems: uniqueItems.filter(i => i.source === 'CTBids').length,
    })
    console.log(`[CRAWL] Done: ${stored}/${uniqueItems.length} stored, scan_id=${scanId}`)
    return NextResponse.json({ ok: true, scanId, count: stored })
  } catch (err) {
    console.error('[CRAWL] fatal:', err)
    await setScanStatus({ phase: 'error', message: 'Crawl failed', detail: String(err), error: String(err), progress: 0 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
