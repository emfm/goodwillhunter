// lib/scan-status-store.ts
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

let _mem: ScanStatus = { ...DEFAULT }

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

// Flatten ScanStatus to snake_case columns for Supabase
function toRow(s: ScanStatus) {
  return {
    id: 1,
    phase: s.phase,
    message: s.message,
    detail: s.detail,
    progress: s.progress,
    started_at: s.startedAt,
    finished_at: s.finishedAt,
    error: s.error,
    keywords_total: s.keywordsTotal ?? null,
    keywords_done: s.keywordsDone ?? null,
    current_keyword: s.currentKeyword ?? null,
    items_found: s.itemsFound ?? null,
    sg_items: s.sgItems ?? null,
    ct_items: s.ctItems ?? null,
    images_total: s.imagesTotal ?? null,
    images_analyzed: s.imagesAnalyzed ?? null,
    real_prices: s.realPrices ?? null,
    ai_prices: s.aiPrices ?? null,
    scan_id: s.scanId ?? null,
  }
}

function fromRow(row: Record<string, unknown>): ScanStatus {
  return {
    phase: (row.phase as ScanStatus['phase']) ?? 'idle',
    message: (row.message as string) ?? '',
    detail: (row.detail as string) ?? '',
    progress: (row.progress as number) ?? 0,
    startedAt: (row.started_at as string) ?? null,
    finishedAt: (row.finished_at as string) ?? null,
    error: (row.error as string) ?? null,
    keywordsTotal: (row.keywords_total as number) ?? undefined,
    keywordsDone: (row.keywords_done as number) ?? undefined,
    currentKeyword: (row.current_keyword as string) ?? undefined,
    itemsFound: (row.items_found as number) ?? undefined,
    sgItems: (row.sg_items as number) ?? undefined,
    ctItems: (row.ct_items as number) ?? undefined,
    imagesTotal: (row.images_total as number) ?? undefined,
    imagesAnalyzed: (row.images_analyzed as number) ?? undefined,
    realPrices: (row.real_prices as number) ?? undefined,
    aiPrices: (row.ai_prices as number) ?? undefined,
    scanId: (row.scan_id as string) ?? undefined,
  }
}

export async function setScanStatus(update: Partial<ScanStatus>): Promise<void> {
  _mem = { ..._mem, ...update }
  const client = db()
  if (!client) { console.warn('[STATUS] no db client — missing env vars'); return }
  const row = toRow(_mem)
  const { error } = await client.from('scan_status').upsert(row)
  if (error) console.error('[STATUS] upsert error:', error.message, JSON.stringify(row).slice(0, 200))
}

export async function getScanStatus(): Promise<ScanStatus> {
  const client = db()
  if (!client) return { ..._mem }
  const { data, error } = await client.from('scan_status').select('*').eq('id', 1).single()
  if (error || !data) return { ...DEFAULT }
  return fromRow(data as Record<string, unknown>)
}

export function resetScanStatus(): void {
  _mem = { ...DEFAULT }
  const client = db()
  if (client) {
    void client.from('scan_status').upsert(toRow(_mem))
  }
}
