// lib/scan-status-store.ts
// In-memory scan progress store — shared across the scanner and route.
// Vercel runs each request in its own isolate, so this is only useful
// within a single scan invocation. The /api/scan-status route reads it
// for real-time progress polling from the UI.

export interface ScanStatus {
  phase: 'idle' | 'starting' | 'crawling_sg' | 'crawling_ct' | 'estimating' | 'analyzing' | 'storing' | 'done' | 'error'
  message: string
  detail: string
  progress: number          // 0–100
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  // crawl counters
  keywordsTotal?: number
  keywordsDone?: number
  currentKeyword?: string
  itemsFound?: number
  sgItems?: number
  ctItems?: number
  // image analysis counters
  imagesTotal?: number
  imagesAnalyzed?: number
}

const DEFAULT: ScanStatus = {
  phase: 'idle',
  message: 'No scan running',
  detail: '',
  progress: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
}

let _status: ScanStatus = { ...DEFAULT }

/** Merge a partial update into the current status */
export function setScanStatus(update: Partial<ScanStatus>): void {
  _status = { ..._status, ...update }
}

/** Get current status snapshot */
export function getScanStatus(): ScanStatus {
  return { ..._status }
}

/** Reset to idle (call at the start of each scan) */
export function resetScanStatus(): void {
  _status = { ...DEFAULT }
}
