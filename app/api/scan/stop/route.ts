// app/api/scan/stop/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requestStop } from '@/lib/scan-stop-store'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  requestStop()
  console.log('[SCAN] Stop requested')
  return NextResponse.json({ ok: true })
}
