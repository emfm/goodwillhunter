// app/api/scan/stop/route.ts
// Sets a flag that the running scan checks between phases to abort early.
// Can't kill a Vercel function mid-execution, but the scanner checks this
// flag after each keyword and after each phase, so it stops within seconds.
import { NextRequest, NextResponse } from 'next/server'

// Module-level flag — shared within the same Vercel function invocation
let _stopRequested = false

export function isStopRequested(): boolean { return _stopRequested }
export function resetStopFlag(): void { _stopRequested = false }

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  _stopRequested = true
  console.log('[SCAN] Stop requested')
  return NextResponse.json({ ok: true })
}
