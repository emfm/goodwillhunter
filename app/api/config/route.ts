import { NextRequest, NextResponse } from 'next/server'
import { getConfig, saveConfig } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const config = await getConfig()
  return NextResponse.json(config)
}

export async function POST(req: NextRequest) {
  const config = await req.json()
  await saveConfig(config)
  return NextResponse.json({ ok: true })
}
