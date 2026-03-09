// app/api/deals/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    // Only allow safe fields to be updated from client
    const allowed = ['dismissed', 'bidded', 'starred']
    const update: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

    const { error } = await supabaseAdmin()
      .from('deals')
      .update(update)
      .eq('id', params.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
