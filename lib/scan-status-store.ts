// lib/scan-status-store.ts
// Stores scan progress in Supabase so the polling GET and the scan POST
// share state across Vercel Lambda isolates (in-memory doesn't work on Vercel).

import { createClient } from '@supabase/supabase-js'

export interface ScanStatus {
  phase: 'idle' | 'starting' | 'crawling_sg' | 'crawling_ct' | 'estimating' | 'analyzing' | 'storing' | 'done' | 'error'
  message: string
  detail: string
  progress: number
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  keywordsTotal?: number
  keywordsDone?: number
  currentKeyword?: string
  itemsFound?: number
  sgItems?: number
  ctItems?: number
  imagesTotal?: number
  imagesAnalyzed?: number
  realPrices?: number
  aiPrices?: number
  scanId?: string
}

const DEFAULT: ScanStatus = {
  phase: 'idle', message: 'No scan running', detail: '', progress: 0,
  startedAt: null, finishedAt: null, error: null,
}

// Fall back to in-memory if Supabase isn't configured (local dev)
let _mem: ScanStatus = { ...DEFAULT }

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function setScanStatus(update: Partial<ScanStatus>): Promise<void> {
  _mem = { ..._mem, ...update }
  const client = db()
  if (!client) return
  await client.from('scan_status').upsert({ id: 1, ..._mem }).then(({ error }) => {
    if (error) console.warn('[STATUS] write error:', error.message)
  })
}

export async function getScanStatus(): Promise<ScanStatus> {
  const client = db()
  if (!client) return { ..._mem }
  const { data, error } = await client.from('scan_status').select('*').eq('id', 1).single()
  if (error || !data) return { ...DEFAULT }
  const { id, ...rest } = data
  return rest as ScanStatus
}

export function resetScanStatus(): void {
  _mem = { ...DEFAULT }
  const client = db()
  if (client) {
    client.from('scan_status').upsert({ id: 1, ..._mem }).then(() => {}).catch(() => {})
  }
}
