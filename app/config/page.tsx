'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Deal } from '@/lib/types'
import { createClient } from '@supabase/supabase-js'

// ── Scan progress overlay ────────────────────────────────────────────────────
interface ScanStatusData {
  phase: string
  message: string
  detail: string
  progress: number
  itemsFound: number
  sgItems: number
  ctItems: number
  currentKeyword: string
  keywordsDone: number
  keywordsTotal: number
  imagesAnalyzed: number
  imagesTotal: number
  scanId?: string
  realPrices?: number
  aiPrices?: number
  error: string | null
}

const PHASE_ICONS: Record<string, string> = {
  idle:         '💤',
  starting:     '🔄',
  crawling_sg:  '🛒',
  crawling_ct:  '🏷️',
  estimating:   '🧠',
  analyzing:    '📸',
  storing:      '💾',
  done:         '✅',
  error:        '❌',
}

function ScanProgress({ status, onClose, onStop }: { status: ScanStatusData; onClose: () => void; onStop: () => void }) {
  const isDone = status.phase === 'done' || status.phase === 'error'
  const isRunning = !isDone
  const icon = PHASE_ICONS[status.phase] ?? '🔄'
  const barColor = status.phase === 'error' ? '#ef4444' : status.phase === 'done' ? '#22c55e' : '#38bdf8'

  const PHASE_LABELS: Record<string, string> = {
    starting: 'Starting up…',
    crawling_sg: 'Searching ShopGoodwill',
    crawling_ct: 'Searching CTBids',
    estimating: 'Looking up prices',
    analyzing: 'Analyzing photos',
    storing: 'Saving to database',
    done: 'Scan complete',
    error: 'Scan failed',
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 rounded-2xl border shadow-2xl overflow-hidden" style={{ background: '#0a111f', borderColor: 'rgba(56,189,248,0.2)' }}>

      {/* Title bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          {isRunning && <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse" />}
          <span className="text-sm font-bold text-slate-100">{isRunning ? 'Scanning…' : status.phase === 'done' ? '✅ Done' : '❌ Failed'}</span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              onClick={onStop}
              className="text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors"
              style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171', background: 'rgba(239,68,68,0.08)' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(239,68,68,0.18)' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'rgba(239,68,68,0.08)' }}
            >
              ■ Stop
            </button>
          )}
          {isDone && (
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none px-1">×</button>
          )}
        </div>
      </div>

      {/* Phase steps */}
      <div className="px-4 pt-3 pb-2 space-y-2">
        {(['crawling_sg', 'crawling_ct', 'estimating', 'analyzing', 'storing'] as const).map(phase => {
          const phaseOrder = ['starting', 'crawling_sg', 'crawling_ct', 'estimating', 'analyzing', 'storing', 'done']
          const currentIdx = phaseOrder.indexOf(status.phase)
          const thisIdx = phaseOrder.indexOf(phase)
          const isActive = status.phase === phase
          const isDoneStep = currentIdx > thisIdx || status.phase === 'done'
          const isPending = currentIdx < thisIdx

          return (
            <div key={phase} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs"
                style={{
                  background: isDoneStep ? 'rgba(34,197,94,0.15)' : isActive ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${isDoneStep ? 'rgba(34,197,94,0.4)' : isActive ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.08)'}`,
                  color: isDoneStep ? '#4ade80' : isActive ? '#38bdf8' : '#475569',
                }}>
                {isDoneStep ? '✓' : isActive ? '●' : '·'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium" style={{ color: isDoneStep ? '#4ade80' : isActive ? '#e2e8f0' : '#475569' }}>
                  {PHASE_LABELS[phase] ?? phase}
                </div>
                {isActive && status.detail && (
                  <div className="text-xs text-slate-500 truncate mt-0.5">{status.detail}</div>
                )}
              </div>
              {isActive && phase === 'crawling_sg' || isActive && phase === 'crawling_ct' ? (
                <div className="text-xs text-slate-500 flex-shrink-0">{status.keywordsDone}/{status.keywordsTotal}</div>
              ) : isActive && phase === 'analyzing' && status.imagesTotal > 0 ? (
                <div className="text-xs text-slate-500 flex-shrink-0">{status.imagesAnalyzed}/{status.imagesTotal}</div>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Valuation source mini-stats — show during/after estimating */}
      {(status.realPrices ?? 0) + (status.aiPrices ?? 0) > 0 && (
        <div className="mx-4 mb-2 flex gap-2 text-xs">
          <div className="flex-1 rounded px-2 py-1.5 text-center" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)' }}>
            <span className="text-green-400 font-bold">{status.realPrices}</span>
            <span className="text-slate-500 ml-1">real comps</span>
          </div>
          <div className="flex-1 rounded px-2 py-1.5 text-center" style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.1)' }}>
            <span className="text-sky-400 font-bold">{status.aiPrices}</span>
            <span className="text-slate-500 ml-1">AI estimates</span>
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="mx-4 mb-3 mt-1 h-1 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${status.progress}%`, background: barColor }} />
      </div>

      {/* Stats — show once we have items */}
      {status.itemsFound > 0 && (
        <div className="flex border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex-1 px-3 py-2.5 text-center border-r" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="text-xs text-slate-500">Found</div>
            <div className="text-base font-black text-white">{status.itemsFound}</div>
          </div>
          <div className="flex-1 px-3 py-2.5 text-center border-r" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="text-xs text-slate-500">SG</div>
            <div className="text-base font-black text-sky-400">{status.sgItems}</div>
          </div>
          <div className="flex-1 px-3 py-2.5 text-center">
            <div className="text-xs text-slate-500">CT</div>
            <div className="text-base font-black text-purple-400">{status.ctItems}</div>
          </div>
        </div>
      )}

      {/* Error message */}
      {status.phase === 'error' && status.error && (
        <div className="mx-4 mb-3 text-xs text-red-400 bg-red-950/40 border border-red-900/40 rounded-lg px-3 py-2 truncate">
          {status.error}
        </div>
      )}
    </div>
  )
}

// ── Condition badge ────────────────────────────────────────────────────────────
// ── Condition badge ───────────────────────────────────────────────────────────
const COND_STYLES: Record<string, string> = {
  Sealed: 'bg-green-950 text-green-400 border-green-700',
  Mint: 'bg-green-950 text-green-300 border-green-800',
  Good: 'bg-emerald-950 text-emerald-400 border-emerald-800',
  Fair: 'bg-yellow-950 text-yellow-400 border-yellow-800',
  Poor: 'bg-red-950 text-red-400 border-red-900',
}

function CondBadge({ cond }: { cond: string | null }) {
  if (!cond || cond === 'Unknown') return null
  const cls = COND_STYLES[cond] ?? 'bg-slate-900 text-slate-400 border-slate-700'
  return <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded border ${cls}`}>{cond}</span>
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 80 ? 'text-green-400' : score >= 60 ? 'text-amber-400' : 'text-slate-400'
  return <span className={`text-2xl font-black ${cls}`}>{score}<span className="text-xs font-normal text-slate-600">/100</span></span>
}

// ── Deal card ─────────────────────────────────────────────────────────────────
function DealCard({ deal, onDismiss, onBid, onStar, isNew }: { deal: Deal; onDismiss: (id: string) => void; onBid: (id: string) => void; onStar: (id: string, starred: boolean) => void; isNew?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const roi = deal.current_bid > 0
    ? Math.round(((deal.adjusted_value - deal.current_bid) / deal.current_bid) * 100)
    : 0
  const mult = deal.value_multiplier
  const adjNote = Math.abs(mult - 1) > 0.05

  const handleDismiss = async () => {
    setDismissing(true)
    await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed: true }),
    })
    onDismiss(deal.id)
  }

  const handleBid = async () => {
    await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidded: true }),
    })
    onBid(deal.id)
    window.open(deal.url, '_blank')
  }

  const handleStar = async () => {
    const next = !deal.starred
    await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred: next }),
    })
    onStar(deal.id, next)
  }

  if (dismissing) return null

  return (
    <div className="card slide-in overflow-hidden flex flex-col">
      {/* Image */}
      <div className="relative">
        <a href={deal.url} target="_blank" rel="noopener noreferrer" className="block">
        {deal.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={deal.image_url}
            alt={deal.title}
            className="w-full h-44 object-cover hover:opacity-90 transition-opacity cursor-pointer"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-44 bg-slate-900 flex items-center justify-center hover:bg-slate-800 transition-colors cursor-pointer">
            <span className="text-slate-600 text-4xl">📦</span>
          </div>
        )}
        </a>
        {/* Score overlay */}
        <div className="absolute top-2 right-2">
          <div className={`text-xs font-black px-2 py-1 rounded-full ${
            deal.deal_score === 100 ? 'bg-orange-500 text-black' :
            deal.deal_score >= 80 ? 'bg-green-500 text-black' :
            deal.deal_score >= 60 ? 'bg-amber-500 text-black' : 'bg-slate-700 text-white'
          }`}>
            {deal.deal_score === 100 ? '🔥' : deal.deal_score}
          </div>
        </div>
        {/* Source badge + NEW badge */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <span className="text-xs px-2 py-0.5 rounded bg-black/70 text-sky-400 border border-sky-900">
            {deal.source}
          </span>
          {isNew && (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-500 text-black font-black tracking-wide">
              NEW
            </span>
          )}
        </div>
        {/* Star button */}
        <button
          onClick={handleStar}
          className="absolute top-2 right-10 w-7 h-7 rounded-full flex items-center justify-center transition-all"
          style={{ background: deal.starred ? 'rgba(251,191,36,0.25)' : 'rgba(0,0,0,0.5)', border: deal.starred ? '1px solid rgba(251,191,36,0.5)' : '1px solid transparent' }}
          title={deal.starred ? 'Unstar' : 'Star this deal'}
        >
          <span className="text-sm">{deal.starred ? '⭐' : '☆'}</span>
        </button>
        {/* Bidded indicator */}
        {deal.bidded && (
          <div className="absolute bottom-2 left-2">
            <span className="text-xs px-2 py-0.5 rounded bg-green-900/80 text-green-400 border border-green-700">
              ✓ Bid placed
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Title */}
        <div>
          <div className="flex items-start gap-2 mb-1">
            <CondBadge cond={deal.condition} />
            <span className="text-xs text-slate-500">{deal.category}</span>
          </div>
          <a href={deal.url} target="_blank" rel="noopener noreferrer" className="hover:text-sky-300 transition-colors">
            <h3 className="text-sm font-semibold text-slate-200 line-clamp-2 leading-snug">{deal.title}</h3>
          </a>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-900/60 rounded p-2 text-center">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Bid</div>
            <div className="text-base font-bold text-white">${deal.current_bid.toFixed(2)}</div>
          </div>
          <div className="bg-slate-900/60 rounded p-2 text-center">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Est. Value</div>
            <div className="text-base font-bold text-green-400">
              ${deal.adjusted_value.toFixed(2)}
              {adjNote && <span className="text-xs text-slate-500 ml-1">{mult > 1 ? '↑' : '↓'}</span>}
            </div>
          </div>
          <div className="bg-slate-900/60 rounded p-2 text-center">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">ROI</div>
            <div className="text-base font-bold text-amber-400">+{roi}%</div>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>⏱ {deal.time_remaining}</span>
          <span>{deal.num_bids} bid{deal.num_bids !== 1 ? 's' : ''}</span>
          <span className="truncate max-w-[120px]">{deal.value_source?.split('(')[0]}</span>
        </div>

        {/* Description */}
        {deal.description && (
          <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-slate-700 pl-2">
            {deal.description}
          </p>
        )}

        {/* Match type + AI analysis */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
            deal.match_type === 'image'
              ? 'bg-purple-950 text-purple-300 border-purple-800'
              : 'bg-slate-900 text-slate-400 border-slate-700'
          }`}>
            {deal.match_type === 'image' ? '🔍 Image match' : '🔤 Text match'}
          </span>
          <span className="text-xs text-slate-600">via "{deal.matched_keyword}"</span>
        </div>

        {/* AI image analysis (expandable, shown if available) */}
        {deal.img_summary && (
          <div className="border border-sky-900/40 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(e => !e)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-sky-500 hover:bg-sky-950/30 transition-colors"
            >
              <span>🤖 AI Image Analysis</span>
              <span className="text-slate-600">{expanded ? '▲' : '▼'}</span>
            </button>
            {expanded && (
              <div className="px-3 pb-3 bg-slate-950/50">
                <p className="text-xs text-slate-400 italic mb-2">"{deal.img_summary}"</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {deal.positives?.map((p, i) => (
                    <div key={i} className="text-xs text-green-400">✓ {p}</div>
                  ))}
                  {deal.flags?.map((f, i) => (
                    <div key={i} className="text-xs text-red-400">⚠ {f}</div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {deal.completeness} · Value adj: <span className={mult >= 1.2 ? 'text-green-400' : mult >= 0.8 ? 'text-amber-400' : 'text-red-400'}>×{mult.toFixed(1)}</span>
                  {deal.is_authentic === false && <span className="ml-2 text-red-400 font-bold">🚨 Authenticity concern</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-auto pt-1">
          <button onClick={handleBid} className="btn btn-green flex-1 justify-center text-xs">
            🎯 Bid Now
          </button>
          <button
            onClick={handleDismiss}
            className="btn btn-ghost text-xs px-3 group relative"
            title="Hide this deal"
          >
            <span className="group-hover:hidden">✕</span>
            <span className="hidden group-hover:inline text-slate-400">Hide</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Filter bar ────────────────────────────────────────────────────────────────
const SOURCES = ['All', 'ShopGoodwill', 'CTBids']
// Starred filter is handled via showStarredOnly state
const CATEGORIES = ['All', 'Computer Games', 'Trading Cards', 'Signatures', 'Comics', 'Vintage Electronics', 'General', 'Other']
const SCORES = [{ label: 'Any score', val: 0 }, { label: '50+', val: 50 }, { label: '60+', val: 60 }, { label: '70+ 🔥', val: 70 }, { label: '80+ 💎', val: 80 }]

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [lastScanId, setLastScanId] = useState<string | null>(null)
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [source, setSource] = useState('All')
  const [category, setCategory] = useState('All')
  const [minScore, setMinScore] = useState(0)
  const [showDismissed, setShowDismissed] = useState(false)
  const [showStarredOnly, setShowStarredOnly] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [kwInput, setKwInput] = useState('')
  const [overrideKeywords, setOverrideKeywords] = useState<string[]>([])
  const [kwOpen, setKwOpen] = useState(false)
  const [sortBy, setSortBy] = useState<'score' | 'price_asc' | 'price_desc' | 'ending'>('score')
  const [scanStatus, setScanStatusData] = useState<ScanStatusData | null>(null)
  const [showProgress, setShowProgress] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const loadDeals = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (source !== 'All') params.set('source', source)
    if (category !== 'All') params.set('category', category)
    if (minScore > 0) params.set('minScore', String(minScore))
    if (showDismissed) params.set('showDismissed', 'true')
    try {
      const res = await fetch(`/api/deals?${params}`)
      if (!res.ok) { console.error('deals fetch failed', res.status, await res.text()); setLoading(false); return }
      const data = await res.json()
      setDeals(Array.isArray(data) ? data : (data?.deals ?? data?.data ?? []))
    } catch (e) {
      console.error('deals fetch error:', e)
    }
    setLoading(false)
  }, [source, category, minScore, showDismissed])

  useEffect(() => { loadDeals() }, [loadDeals])

  // Load last scan time
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => setConfig(d)).catch(() => null)
    fetch('/api/deals?showDismissed=false&minScore=0')
      .then(() => {})
    // get last scan from meta endpoint
    ;(async () => {
      try {
        const r = await fetch('/api/scan-status')
        if (r.ok) { const d = await r.json(); setLastScan(d.lastScan) }
      } catch {/* ignore */}
    })()
  }, [])

  // Poll scan progress every 2s — reads Supabase directly to avoid Vercel Lambda isolation
  useEffect(() => {
    if (!scanning) return
    setShowProgress(true)
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const interval = setInterval(async () => {
      try {
        const { data } = await db.from('scan_status').select('*').eq('id', 1).single()
        if (!data) return
        const s: ScanStatusData = {
          phase: data.phase ?? 'idle',
          message: data.message ?? '',
          detail: data.detail ?? '',
          progress: data.progress ?? 0,
          itemsFound: data.items_found ?? 0,
          sgItems: data.sg_items ?? 0,
          ctItems: data.ct_items ?? 0,
          currentKeyword: data.current_keyword ?? '',
          keywordsDone: data.keywords_done ?? 0,
          keywordsTotal: data.keywords_total ?? 0,
          imagesAnalyzed: data.images_analyzed ?? 0,
          imagesTotal: data.images_total ?? 0,
          realPrices: data.real_prices ?? 0,
          aiPrices: data.ai_prices ?? 0,
          scanId: data.scan_id ?? undefined,
          error: data.error ?? null,
        }
        setScanStatusData(s)
        if (s.phase === 'done' || s.phase === 'error') {
          clearInterval(interval)
          setScanning(false)
          if (s.phase === 'done') {
            await loadDeals()
            setLastScan(new Date().toISOString())
            if (s.scanId) setLastScanId(s.scanId)
          }
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [scanning, loadDeals])

  const getSecret = (): string | null => {
    // Store CRON_SECRET in sessionStorage so we only ask once per browser session
    let s = sessionStorage.getItem('gh_secret')
    if (!s) {
      s = prompt('Enter your CRON_SECRET (only asked once per session):')
      if (!s) return null
      sessionStorage.setItem('gh_secret', s)
    }
    return s
  }

  const triggerScan = async () => {
    const secret = getSecret()
    if (!secret) return
    setScanning(true)
    setShowProgress(true)
    setScanStatusData({ phase: 'starting', message: 'Initializing scan…', detail: 'Connecting to sources', progress: 1, itemsFound: 0, sgItems: 0, ctItems: 0, currentKeyword: '', keywordsDone: 0, keywordsTotal: config?.keywords?.length ?? 0, imagesAnalyzed: 0, imagesTotal: 0, error: null })

    const headers: Record<string, string> = { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json' }
    const kwBody = overrideKeywords.length ? JSON.stringify({ keywords: overrideKeywords }) : undefined

    // Phase 1: Crawl — await it so we get scanId back before firing estimate
    let scanId: string | null = null
    try {
      const r1 = await fetch('/api/scan/crawl', { method: 'POST', headers, body: kwBody })
      if (!r1.ok) { const t = await r1.text(); throw new Error(`Crawl failed (${r1.status}): ${t}`) }
      const d1 = await r1.json()
      if (d1.error) throw new Error(d1.error)
      scanId = d1.scanId
      if (d1.count === 0) {
        setScanStatusData(s => s ? { ...s, phase: 'done', message: 'No items found', detail: 'Try different keywords or check source settings', progress: 100 } : null)
        setScanning(false)
        return
      }
    } catch (e) {
      setScanStatusData(s => s ? { ...s, phase: 'error', message: '❌ Crawl failed', detail: String(e), error: String(e) } : null)
      setScanning(false)
      return
    }

    // Phase 2 + 3: estimate then finalize — each awaited so we can load deals at the end
    try {
      const r2 = await fetch('/api/scan/estimate', { method: 'POST', headers, body: JSON.stringify({ scanId }) })
      if (!r2.ok) throw new Error(`Estimate failed: ${r2.status}`)

      const r3 = await fetch('/api/scan/finalize', { method: 'POST', headers, body: JSON.stringify({ scanId }) })
      if (!r3.ok) throw new Error(`Finalize failed: ${r3.status}`)
    } catch (e) {
      console.error('[SCAN] phase 2/3 error:', e)
      // Don't bail — finalize may have partially succeeded; fall through to loadDeals
    }

    // Always load deals when scan completes, regardless of polling state
    await loadDeals()
    setLastScan(new Date().toISOString())
    setScanning(false)
  }

  const stopScan = async () => {
    const secret = sessionStorage.getItem('gh_secret')
    if (secret) {
      await fetch('/api/scan/stop', { method: 'POST', headers: { 'Authorization': `Bearer ${secret}` } }).catch(() => {})
    }
    setScanning(false)
    setScanStatusData(s => s ? { ...s, phase: 'done', message: 'Scan stopped', detail: 'Manually stopped', progress: 100 } : null)
    await loadDeals()
  }

  const activeBidded = deals.filter(d => d.bidded && !d.dismissed).length
  const starredCount = deals.filter(d => d.starred && !d.dismissed).length

  const handleStar = (id: string, starred: boolean) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, starred } : d))
  }

  const sortedDeals = [...deals].sort((a, b) => {
    // Starred always float to top
    if (a.starred && !b.starred) return -1
    if (!a.starred && b.starred) return 1
    if (sortBy === 'score')      return b.deal_score - a.deal_score
    if (sortBy === 'price_asc')  return a.current_bid - b.current_bid
    if (sortBy === 'price_desc') return b.current_bid - a.current_bid
    if (sortBy === 'ending') {
      const tA = new Date(a.end_time).getTime()
      const tB = new Date(b.end_time).getTime()
      return tA - tB
    }
    return 0
  })
  const hotDeals = deals.filter(d => d.deal_score >= 70 && !d.dismissed).length
  const displayDeals = showStarredOnly ? sortedDeals.filter(d => d.starred) : sortedDeals
  const avgScore = deals.length ? Math.round(deals.reduce((s, d) => s + d.deal_score, 0) / deals.length) : 0

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 border border-slate-600 text-sm text-slate-200 px-4 py-3 rounded-lg shadow-xl slide-in">
          {toast}
        </div>
      )}

      {/* Scan progress overlay */}
      {showProgress && scanStatus && (
        <ScanProgress
          status={scanStatus}
          onClose={() => { setShowProgress(false); setScanStatusData(null) }}
          onStop={stopScan}
        />
      )}

      {/* Header */}
      <header className="border-b sticky top-0 z-40 backdrop-blur-md" style={{ borderColor: 'var(--border2)', background: 'rgba(8,13,24,0.95)' }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎯</span>
            <div>
              <div className="text-lg font-black text-sky-400 tracking-tight">Goodwill Hunter</div>
              {lastScan && (
                <div className="text-xs text-slate-500">
                  Last scan: {new Date(lastScan).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
              )}
            </div>
          </div>

          {/* Stats pills */}
          <div className="hidden md:flex items-center gap-3">
            <div className="text-xs px-3 py-1.5 rounded-full bg-slate-900 border border-slate-700">
              <span className="text-slate-400">Total </span>
              <span className="text-white font-bold">{deals.length}</span>
            </div>
            {hotDeals > 0 && (
              <div className="text-xs px-3 py-1.5 rounded-full bg-green-950 border border-green-800">
                <span className="text-green-400">🔥 Hot </span>
                <span className="text-green-300 font-bold">{hotDeals}</span>
              </div>
            )}
            {starredCount > 0 && (
              <div className="text-xs px-3 py-1.5 rounded-full bg-amber-950 border border-amber-800">
                <span className="text-amber-400">⭐ </span>
                <span className="text-amber-300 font-bold">{starredCount}</span>
              </div>
            )}
            {activeBidded > 0 && (
              <div className="text-xs px-3 py-1.5 rounded-full bg-sky-950 border border-sky-800">
                <span className="text-sky-400">Bid on </span>
                <span className="text-sky-300 font-bold">{activeBidded}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {scanning ? (
              <button onClick={stopScan} className="btn text-xs font-bold" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}>
                <span className="inline-block w-2 h-2 rounded-full bg-red-400 animate-pulse mr-1.5" />
                Stop Scan
              </button>
            ) : (
              <button onClick={triggerScan} className="btn btn-primary text-xs">⚡ Run Scan</button>
            )}
            <Link href="/config" className="btn btn-ghost text-xs">⚙ Config</Link>
          </div>
        </div>
      </header>

      {/* Keyword override panel */}
      <div className="border-b" style={{ borderColor: 'var(--border2)', background: 'var(--surface)' }}>
        <div className="max-w-7xl mx-auto px-4">
          <button
            onClick={() => setKwOpen(o => !o)}
            className="w-full flex items-center justify-between py-2.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
          >
            <span className="flex items-center gap-2">
              🔍 <span>Keyword overrides</span>
              {overrideKeywords.length > 0 && (
                <span className="bg-sky-900 text-sky-300 border border-sky-700 px-2 py-0.5 rounded-full text-xs font-bold">
                  {overrideKeywords.length} active
                </span>
              )}
              {overrideKeywords.length === 0 && (
                <span className="text-slate-600">— using saved config keywords</span>
              )}
            </span>
            <span className="text-slate-600">{kwOpen ? '▲' : '▼'}</span>
          </button>

          {kwOpen && (
            <div className="pb-3 flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {overrideKeywords.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-sky-950 text-sky-300 border border-sky-800 font-medium">
                    {kw}
                    <button
                      onClick={() => setOverrideKeywords(prev => prev.filter(k => k !== kw))}
                      className="text-sky-600 hover:text-red-400 transition-colors leading-none ml-0.5"
                    >×</button>
                  </span>
                ))}
                {overrideKeywords.length === 0 && (
                  <span className="text-xs text-slate-600 italic">No overrides — next scan uses your saved keywords</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={kwInput}
                  onChange={e => setKwInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      const v = kwInput.trim().toLowerCase()
                      if (v && !overrideKeywords.includes(v)) setOverrideKeywords(prev => [...prev, v])
                      setKwInput('')
                    }
                  }}
                  placeholder="Type keyword, press Enter to add…"
                  className="flex-1 text-xs px-3 py-1.5 rounded-md border"
                  style={{ background: '#0f172a', borderColor: 'var(--border2)', color: '#e2e8f0', outline: 'none' }}
                />
                <button
                  onClick={() => {
                    const v = kwInput.trim().toLowerCase()
                    if (v && !overrideKeywords.includes(v)) setOverrideKeywords(prev => [...prev, v])
                    setKwInput('')
                  }}
                  className="btn btn-ghost text-xs px-3"
                >+ Add</button>
                {overrideKeywords.length > 0 && (
                  <button
                    onClick={() => setOverrideKeywords([])}
                    className="text-xs px-3 py-1.5 rounded-md text-red-500 hover:text-red-300 hover:bg-red-950/30 transition-colors border border-transparent hover:border-red-900"
                  >✕ Clear all</button>
                )}
              </div>
              <p className="text-xs text-slate-600">
                These keywords replace your saved config for the next scan only. Comma or Enter to add.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="border-b" style={{ borderColor: 'var(--border2)', background: 'var(--surface)' }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          {/* Source tabs */}
          <div className="flex gap-1">
            {SOURCES.map(s => (
              <button key={s} onClick={() => setSource(s)}
                className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-all ${
                  source === s ? 'bg-sky-900 text-sky-300 border border-sky-700' : 'text-slate-500 hover:text-slate-300'
                }`}>{s}</button>
            ))}
          </div>

          <div className="w-px h-5 bg-slate-700" />

          {/* Category */}
          <select value={category} onChange={e => setCategory(e.target.value)} className="w-auto text-xs py-1.5 pl-2 pr-6">
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>

          {/* Min score */}
          <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="w-auto text-xs py-1.5 pl-2 pr-6">
            {SCORES.map(s => <option key={s.val} value={s.val}>{s.label}</option>)}
          </select>

          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer ml-auto">
            <input type="checkbox" checked={showDismissed} onChange={e => setShowDismissed(e.target.checked)}
              className="w-3.5 h-3.5 accent-sky-500" />
            Show dismissed
          </label>

          <div className="flex gap-1 ml-auto items-center">
            <span className="text-xs text-slate-600 mr-1">Sort:</span>
            {([
              { val: 'score',      label: '🏆 Score' },
              { val: 'price_asc',  label: '💰 Cheapest' },
              { val: 'price_desc', label: '💰 Priciest' },
              { val: 'ending',     label: '⏱ Ending' },
            ] as const).map(s => (
              <button key={s.val} onClick={() => setSortBy(s.val)}
                className={`text-xs px-2.5 py-1.5 rounded-md font-semibold transition-all ${
                  sortBy === s.val ? 'bg-sky-900 text-sky-300 border border-sky-700' : 'text-slate-500 hover:text-slate-300'
                }`}>{s.label}</button>
            ))}
          </div>
          <button onClick={loadDeals} className="btn btn-ghost text-xs py-1.5 px-3">↻ Refresh</button>
        </div>
      </div>

      {/* Deal grid */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <div className="w-10 h-10 border-3 border-sky-500 border-t-transparent rounded-full spinner" style={{ borderWidth: 3 }} />
            <div className="text-slate-500 text-sm">Loading deals…</div>
          </div>
        ) : displayDeals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
            <div className="text-6xl">🎯</div>
            <div className="text-slate-300 font-semibold text-lg">No deals found</div>
            <div className="text-slate-500 text-sm max-w-sm">
              Run a scan to find deals, or adjust your filters to see more results.
            </div>
            <button onClick={triggerScan} className="btn btn-primary mt-2">⚡ Run First Scan</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {displayDeals.map(deal => (
              <DealCard
                key={deal.id}
                deal={deal}
                isNew={!!(lastScanId && deal.scan_id === lastScanId)}
                onDismiss={id => setDeals(prev => prev.filter(d => d.id !== id))}
                onBid={id => setDeals(prev => prev.map(d => d.id === id ? { ...d, bidded: true } : d))}
                onStar={handleStar}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
