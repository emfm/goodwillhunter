// app/watchlist/page.tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Deal } from '@/lib/types'

function timeAgo(iso: string | null) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function timeLeft(end: string | null) {
  if (!end) return null
  const diff = new Date(end).getTime() - Date.now()
  if (diff < 0) return 'Ended'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h > 48) return `${Math.floor(h/24)}d left`
  if (h > 0) return `${h}h ${m}m left`
  return `${m}m left`
}

function roi(d: Deal) {
  if (!d.estimated_value || !d.current_bid || d.current_bid === 0) return null
  return ((d.estimated_value - d.current_bid) / d.estimated_value * 100)
}

function DealRow({ deal, onToggleBid, onRemove }: {
  deal: Deal
  onToggleBid: (id: string, bidded: boolean) => void
  onRemove: (id: string) => void
}) {
  const r = roi(deal)
  const tl = timeLeft(deal.end_time)
  const ending = tl && tl !== 'Ended' && !tl.includes('d') && parseInt(tl) < 4
  const ended = tl === 'Ended'

  const handleToggleBid = async () => {
    const next = !deal.bidded
    await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidded: next }),
    }).catch(() => {})
    onToggleBid(deal.id, next)
  }

  const handleRemove = async () => {
    await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred: false }),
    }).catch(() => {})
    onRemove(deal.id)
  }

  return (
    <div className={`rounded-xl border p-3 flex gap-3 transition-all ${ended ? 'opacity-50 border-slate-800 bg-slate-900/40' : deal.bidded ? 'border-green-800 bg-green-950/30' : 'border-slate-800 bg-slate-900'}`}>
      {/* Image */}
      <a href={deal.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
        {deal.image_url
          ? <img src={deal.image_url} alt={deal.title} className="w-20 h-20 object-cover rounded-lg" onError={e => { (e.target as HTMLImageElement).style.display='none' }} />
          : <div className="w-20 h-20 bg-slate-800 rounded-lg flex items-center justify-center text-3xl">📦</div>
        }
      </a>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <a href={deal.url} target="_blank" rel="noopener noreferrer"
            className="text-sm font-semibold text-slate-100 hover:text-white line-clamp-2 leading-snug">
            {deal.title}
          </a>
          <button onClick={handleRemove} className="text-slate-600 hover:text-slate-400 text-xs flex-shrink-0 mt-0.5">✕</button>
        </div>

        {/* Prices */}
        <div className="flex gap-3 mt-1.5 text-xs flex-wrap">
          <span className="text-slate-400">Bid: <span className="text-white font-bold">${deal.current_bid?.toFixed(2)}</span></span>
          <span className="text-slate-400">Est: <span className="text-green-400 font-bold">${deal.estimated_value?.toFixed(0)}</span></span>
          {r !== null && <span className={`font-bold ${r >= 0 ? 'text-green-400' : 'text-red-400'}`}>{r >= 0 ? '+' : ''}{r.toFixed(0)}% ROI</span>}
          <span className={`font-semibold ${ended ? 'text-slate-500' : ending ? 'text-red-400' : 'text-slate-400'}`}>
            {tl ?? '—'}
          </span>
          {deal.num_bids !== undefined && <span className="text-slate-500">{deal.num_bids} bids</span>}
        </div>

        {/* Source + score */}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-sky-400">{deal.source}</span>
          <span className={`text-xs font-black px-2 py-0.5 rounded-full ${deal.deal_score >= 80 ? 'bg-green-500 text-black' : deal.deal_score >= 60 ? 'bg-amber-500 text-black' : 'bg-slate-700 text-white'}`}>
            {deal.deal_score}
          </span>
          {deal.value_source && <span className="text-xs text-slate-600 truncate max-w-32">{deal.value_source}</span>}
        </div>

        {/* Bid toggle */}
        <div className="mt-2">
          <button onClick={handleToggleBid}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${deal.bidded ? 'bg-green-900 text-green-300 border border-green-700 hover:bg-red-900 hover:text-red-300 hover:border-red-700' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-green-900 hover:text-green-300 hover:border-green-700'}`}>
            {deal.bidded ? '✓ Bid placed — click to undo' : '🎯 Mark as bid'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WatchlistPage() {
  const [allDeals, setAllDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'bids' | 'watching'>('bids')
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/deals?showDismissed=false')
      .then(r => r.json())
      .then((data: Deal[]) => {
        if (Array.isArray(data)) setAllDeals(data)
        setLoading(false)
        setLastRefresh(new Date())
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const bids = allDeals.filter(d => d.bidded).sort((a, b) => {
    // Active (not ended) first, then by time left
    const aEnd = new Date(a.end_time).getTime()
    const bEnd = new Date(b.end_time).getTime()
    const now = Date.now()
    const aActive = aEnd > now ? 1 : 0
    const bActive = bEnd > now ? 1 : 0
    if (bActive !== aActive) return bActive - aActive
    return aEnd - bEnd // soonest ending first
  })

  const watching = allDeals.filter(d => d.starred && !d.bidded).sort((a, b) => {
    return new Date(a.end_time).getTime() - new Date(b.end_time).getTime()
  })

  const handleToggleBid = (id: string, bidded: boolean) => {
    setAllDeals(prev => prev.map(d => d.id === id ? { ...d, bidded } : d))
  }
  const handleRemove = (id: string) => {
    setAllDeals(prev => prev.map(d => d.id === id ? { ...d, starred: false } : d))
  }

  const totalBid = bids.reduce((s, d) => s + (d.current_bid ?? 0), 0)
  const totalEst = bids.reduce((s, d) => s + (d.estimated_value ?? 0), 0)
  const activeBids = bids.filter(d => new Date(d.end_time).getTime() > Date.now())

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🎯</span>
            <div>
              <div className="font-bold text-sm">Goodwill Hunter</div>
              <div className="text-xs text-slate-500">Watchlist · refreshed {timeAgo(lastRefresh.toISOString())}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="text-xs text-slate-500 hover:text-slate-300 px-2">↻</button>
            <Link href="/" className="text-xs text-sky-400 hover:text-sky-300">← Dashboard</Link>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2">
          <button onClick={() => setTab('bids')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === 'bids' ? 'bg-green-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            🎯 My Bids {bids.length > 0 && `(${bids.length})`}
          </button>
          <button onClick={() => setTab('watching')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === 'watching' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            ★ Watchlist {watching.length > 0 && `(${watching.length})`}
          </button>
        </div>

        {/* Bid summary */}
        {tab === 'bids' && bids.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 text-center">
              <div className="text-xs text-slate-500 mb-0.5">Active bids</div>
              <div className="text-lg font-bold text-white">{activeBids.length}</div>
            </div>
            <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 text-center">
              <div className="text-xs text-slate-500 mb-0.5">Total in</div>
              <div className="text-lg font-bold text-white">${totalBid.toFixed(2)}</div>
            </div>
            <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 text-center">
              <div className="text-xs text-slate-500 mb-0.5">Est. value</div>
              <div className="text-lg font-bold text-green-400">${totalEst.toFixed(0)}</div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === 'bids' ? (
          bids.length === 0 ? (
            <div className="text-center py-20 text-slate-500 space-y-2">
              <div className="text-5xl">🎯</div>
              <div className="font-semibold">No bids yet</div>
              <div className="text-xs">Click "Mark as bid" on watchlist items, or use "Bid Now" on the dashboard</div>
            </div>
          ) : (
            <div className="space-y-3">
              {bids.map(d => <DealRow key={d.id} deal={d} onToggleBid={handleToggleBid} onRemove={handleRemove} />)}
            </div>
          )
        ) : (
          watching.length === 0 ? (
            <div className="text-center py-20 text-slate-500 space-y-2">
              <div className="text-5xl">★</div>
              <div className="font-semibold">Watchlist is empty</div>
              <div className="text-xs">Click "Watch" on any deal in the dashboard to save it here</div>
            </div>
          ) : (
            <div className="space-y-3">
              {watching.map(d => <DealRow key={d.id} deal={d} onToggleBid={handleToggleBid} onRemove={handleRemove} />)}
            </div>
          )
        )}
      </div>
    </div>
  )
}
