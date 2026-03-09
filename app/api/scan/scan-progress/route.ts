// app/api/scan-progress/route.ts
import { NextResponse } from 'next/server'
import { getScanStatus } from '@/lib/scan-status-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const status = await getScanStatus()
  return NextResponse.json(status)
}
