// app/api/deals/route.ts  ← this is the LIST route, NOT [id]
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const source        = searchParams.get('source')
    const category      = searchParams.get('category')
    const minScore      = parseInt(searchParams.get('minScore') ?? '0')
    const showDismissed = searchParams.get('showDismissed') === 'true'

    const db = supabaseAdmin()
    let q = db
      .from('deals')
      .select('*')
      .order('deal_score', { ascending: false })
      .limit(500)

    if (!showDismissed) q = q.or('dismissed.is.null,dismissed.eq.false')
    if (source)         q = q.eq('source', source)
    if (category && category !== 'All') q = q.eq('category', category)
    if (minScore > 0)   q = q.gte('deal_score', minScore)

    const { data, error } = await q

    if (error) {
      console.error('[API/deals] Supabase error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data ?? [])
  } catch (err) {
    console.error('[API/deals] Unexpected error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
