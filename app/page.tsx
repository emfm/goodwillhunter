'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Deal } from '@/lib/types'

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
function DealCard({ deal, onDismiss, onBid }: { deal: Deal; onDismiss: (id: string) => void; onBid: (id: string) => void }) {
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

  if (dismissing) return null

  return (
    <div className="card slide-in overflow-hidden flex flex-col">
      {/* Image */}
      <div className="relative">
        {deal.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={deal.image_url}
            alt={deal.title}
            className="w-full h-44 object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-44 bg-slate-900 flex items-center justify-center">
            <span className="text-slate-600 text-4xl">📦</span>
          </div>
        )}
        {/* Score overlay */}
        <div className="absolute top-2 right-2">
          <div className={`text-xs font-black px-2 py-1 rounded-full ${
            deal.deal_score >= 80 ? 'bg-green-500 text-black' :
            deal.deal_score >= 60 ? 'bg-amber-500 text-black' : 'bg-slate-700 text-white'
          }`}>
            {deal.deal_score}
          </div>
        </div>
        {/* Source badge */}
        <div className="absolute top-2 left-2">
          <span className="text-xs px-2 py-0.5 rounded bg-black/70 text-sky-400 border border-sky-900">
            {deal.source}
          </span>
        </div>
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
          <h3 className="text-sm font-semibold text-slate-200 line-clamp-2 leading-snug">{deal.title}</h3>
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

        {/* AI analysis (expandable) */}
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
          <button onClick={handleDismiss} className="btn btn-ghost text-xs px-3">
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Filter bar ────────────────────────────────────────────────────────────────
const SOURCES = ['All', 'ShopGoodwill', 'CTBids']
const CATEGORIES = ['All', 'Atari', 'Console Games', 'Big Box PC Game', 'Signed / Autograph', 'Trading Cards', 'Vintage Electronics', 'General']
const SCORES = [{ label: 'Any score', val: 0 }, { label: '50+', val: 50 }, { label: '60+', val: 60 }, { label: '70+ 🔥', val: 70 }, { label: '80+ 💎', val: 80 }]

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [source, setSource] = useState('All')
  const [category, setCategory] = useState('All')
  const [minScore, setMinScore] = useState(0)
  const [showDismissed, setShowDismissed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

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
    const res = await fetch(`/api/deals?${params}`)
    const data = await res.json()
    setDeals(data)
    setLoading(false)
  }, [source, category, minScore, showDismissed])

  useEffect(() => { loadDeals() }, [loadDeals])

  // Load last scan time
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).catch(() => null)
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

  const triggerScan = async () => {
    setScanning(true)
    showToast('Scan started — this can take 2–5 minutes…')
    try {
      const secret = prompt('Enter your CRON_SECRET (from .env):')
      if (!secret) { setScanning(false); return }
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
      })
      const data = await res.json()
      showToast(`✅ Scan complete — ${data.count ?? 0} deals found`)
      await loadDeals()
      setLastScan(new Date().toISOString())
    } catch (e) {
      showToast('❌ Scan error — check console')
      console.error(e)
    }
    setScanning(false)
  }

  const activeBidded = deals.filter(d => d.bidded && !d.dismissed).length
  const hotDeals = deals.filter(d => d.deal_score >= 70 && !d.dismissed).length
  const avgScore = deals.length ? Math.round(deals.reduce((s, d) => s + d.deal_score, 0) / deals.length) : 0

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 border border-slate-600 text-sm text-slate-200 px-4 py-3 rounded-lg shadow-xl slide-in">
          {toast}
        </div>
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
            {activeBidded > 0 && (
              <div className="text-xs px-3 py-1.5 rounded-full bg-sky-950 border border-sky-800">
                <span className="text-sky-400">Bid on </span>
                <span className="text-sky-300 font-bold">{activeBidded}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={triggerScan}
              disabled={scanning}
              className="btn btn-primary text-xs"
            >
              {scanning ? <><span className="spinner inline-block w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full" />Scanning…</> : '⚡ Run Scan'}
            </button>
            <Link href="/config" className="btn btn-ghost text-xs">⚙ Config</Link>
          </div>
        </div>
      </header>

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
        ) : deals.length === 0 ? (
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
            {deals.map(deal => (
              <DealCard
                key={deal.id}
                deal={deal}
                onDismiss={id => setDeals(prev => prev.filter(d => d.id !== id))}
                onBid={id => setDeals(prev => prev.map(d => d.id === id ? { ...d, bidded: true } : d))}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
