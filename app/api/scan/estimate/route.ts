// app/api/scan/estimate/route.ts
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { scanId } = await req.json()
    if (!scanId) return NextResponse.json({ error: 'scanId required' }, { status: 400 })

    const db = supabaseAdmin()
    const { data: items, error } = await db
      .from('raw_scan_items')
      .select('url,title,current_bid')
      .eq('scan_id', scanId)

    if (error) {
      console.error('[ESTIMATE] fetch error:', error.message, error.code)
      if (error.code === '42P01') return NextResponse.json({ error: 'Table raw_scan_items not found. Run migration.sql.' }, { status: 500 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!items?.length) {
      console.warn('[ESTIMATE] No items found for scanId:', scanId)
      return NextResponse.json({ ok: true, estimated: 0, message: 'No items to estimate' })
    }

    console.log(`[ESTIMATE] Pricing ${items.length} items for ${scanId}`)
    await setScanStatus({ phase: 'estimating', message: 'Looking up prices…', detail: `${items.length} items`, progress: 40 })

    const { updates, realPrices, aiPrices } = await estimateValuesForScan(items, scanId)

    // Update estimated_value per row — use individual updates to avoid upsert conflicts
    const CHUNK = 100
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK)
      await Promise.all(chunk.map(u =>
        db.from('raw_scan_items')
          .update({ estimated_value: u.value, value_source: u.source })
          .eq('scan_id', scanId)
          .eq('url', u.url)
      ))
    }

    await setScanStatus({ phase: 'analyzing', message: 'Prices done', detail: `${realPrices} real comps · ${aiPrices} AI estimates`, progress: 65, realPrices, aiPrices })
    console.log(`[ESTIMATE] Done: ${updates.length} items, real=${realPrices}, ai=${aiPrices}`)
    return NextResponse.json({ ok: true, estimated: updates.length, realPrices, aiPrices })
  } catch (err) {
    console.error('[ESTIMATE] fatal:', err)
    await setScanStatus({ phase: 'error', message: 'Estimation failed', detail: String(err), error: String(err), progress: 0 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
