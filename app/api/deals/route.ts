import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const source = searchParams.get('source')
  const category = searchParams.get('category')
  const minScore = parseInt(searchParams.get('minScore') ?? '0')
  const showDismissed = searchParams.get('showDismissed') === 'true'

  const db = supabaseAdmin()
  let query = db
    .from('deals')
    .select('*')
    .order('deal_score', { ascending: false })
    .limit(200)

  if (!showDismissed) query = query.eq('dismissed', false)
  if (source) query = query.eq('source', source)
  if (category) query = query.eq('category', category)
  if (minScore > 0) query = query.gte('deal_score', minScore)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
