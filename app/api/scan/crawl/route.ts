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

    if (!items.length) {
      await setScanStatus({ phase: 'done', message: 'No items found', detail: 'Try different keywords', progress: 100, finishedAt: new Date().toISOString() })
      return NextResponse.json({ ok: true, scanId, count: 0 })
    }

    // Ensure table exists, then store
    const db = supabaseAdmin()

    // Create table if missing (idempotent)
    await db.rpc('exec_sql', { sql: `
      CREATE TABLE IF NOT EXISTS raw_scan_items (
        id bigserial PRIMARY KEY,
        scan_id text NOT NULL,
        url text NOT NULL,
        title text, current_bid numeric, image_url text, source text,
        end_time text, time_remaining text, num_bids integer DEFAULT 0,
        matched_keyword text, match_type text DEFAULT 'text',
        estimated_value numeric, value_source text,
        condition text, condition_score integer, completeness text,
        is_authentic boolean, value_multiplier numeric DEFAULT 1,
        flags jsonb DEFAULT '[]', positives jsonb DEFAULT '[]', img_summary text,
        created_at timestamptz DEFAULT now(),
        UNIQUE(url)
      );
      ALTER TABLE raw_scan_items DISABLE ROW LEVEL SECURITY;
    ` }).catch(() => {}) // rpc may not exist — fallback below

    const CHUNK = 500
    let stored = 0
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK).map(item => ({
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
      const { error, count } = await db.from('raw_scan_items').upsert(chunk, { onConflict: 'url' })
      if (error) {
        console.error(`[CRAWL] upsert chunk ${i}-${i+CHUNK} error:`, error.message, error.code)
        // If table doesn't exist, return error so user knows to run migration
        if (error.code === '42P01') {
          return NextResponse.json({ error: 'Table raw_scan_items not found. Please run migration.sql in Supabase.' }, { status: 500 })
        }
      } else {
        stored += chunk.length
      }
    }

    await setScanStatus({
      phase: 'estimating', message: 'Crawl complete', progress: 35,
      detail: `${stored} items stored — SG: ${items.filter(i => i.source==='ShopGoodwill').length}, CT: ${items.filter(i=>i.source==='CTBids').length}`,
      itemsFound: items.length,
      sgItems: items.filter(i => i.source === 'ShopGoodwill').length,
      ctItems: items.filter(i => i.source === 'CTBids').length,
    })
    console.log(`[CRAWL] Done: ${stored}/${items.length} stored, scan_id=${scanId}`)
    return NextResponse.json({ ok: true, scanId, count: stored })
  } catch (err) {
    console.error('[CRAWL] fatal:', err)
    await setScanStatus({ phase: 'error', message: 'Crawl failed', detail: String(err), error: String(err), progress: 0 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
