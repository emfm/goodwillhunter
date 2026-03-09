// app/watchlist/page.tsx
// Shareable bids + starred watchlist — no auth required (read-only)
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Deal } from '@/lib/types'

function roi(d: Deal) {
  if (!d.estimated_value || !d.current_bid) return null
  return ((d.estimated_value - d.current_bid) / d.estimated_value * 100)
}

function TimeLeft({ t }: { t: string | null }) {
  if (!t) return <span className="text-slate-600">—</span>
  return <span className="text-slate-400 text-xs">{t}</span>
}

function DealRow({ deal }: { deal: Deal }) {
  const r = roi(deal)
  return (
    <a href={deal.url} target="_blank" rel="noopener noreferrer"
      className="flex gap-3 p-3 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors border border-slate-800 hover:border-slate-600 group">
      {deal.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={deal.image_url} alt={deal.title} className="w-20 h-20 object-cover rounded flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display='none'}} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-medium text-slate-200 line-clamp-2 group-hover:text-white">{deal.title}</div>
          <div className={`text-xs font-black px-2 py-0.5 rounded-full flex-shrink-0 ${
            deal.deal_score >= 80 ? 'bg-green-500 text-black' :
            deal.deal_score >= 60 ? 'bg-amber-500 text-black' : 'bg-slate-700 text-white'
          }`}>{deal.deal_score}</div>
        </div>
        <div className="flex gap-4 mt-1.5 text-xs">
          <span className="text-slate-400">Bid: <span className="text-white font-semibold">${deal.current_bid?.toFixed(2)}</span></span>
          <span className="text-slate-400">Est: <span className="text-green-400 font-semibold">${deal.estimated_value?.toFixed(0)}</span></span>
          {r !== null && (
            <span className={r >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
              {r >= 0 ? '+' : ''}{r.toFixed(0)}% ROI
            </span>
          )}
          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-sky-400">{deal.source}</span>
        </div>
        <div className="flex gap-3 mt-1 text-xs text-slate-500">
          <TimeLeft t={deal.time_remaining} />
          {deal.num_bids > 0 && <span>{deal.num_bids} bids</span>}
          {deal.value_source && <span className="truncate max-w-xs">{deal.value_source}</span>}
        </div>
      </div>
    </a>
  )
}

export default function WatchlistPage() {
  const [bids, setBids] = useState<Deal[]>([])
  const [starred, setStarred] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'bids' | 'watching'>('bids')

  useEffect(() => {
    fetch('/api/deals?showDismissed=false')
      .then(r => r.json())
      .then((data: Deal[]) => {
        if (!Array.isArray(data)) return
        setBids(data.filter(d => d.bidded).sort((a, b) => (b.deal_score ?? 0) - (a.deal_score ?? 0)))
        setStarred(data.filter(d => d.starred && !d.bidded).sort((a, b) => (b.deal_score ?? 0) - (a.deal_score ?? 0)))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const totalBidValue = bids.reduce((s, d) => s + (d.current_bid ?? 0), 0)
  const totalEstValue = bids.reduce((s, d) => s + (d.estimated_value ?? 0), 0)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🎯</span>
            <div>
              <div className="font-bold text-sm">Goodwill Hunter</div>
              <div className="text-xs text-slate-500">Watchlist</div>
            </div>
          </div>
          <Link href="/" className="text-xs text-sky-400 hover:text-sky-300">← Dashboard</Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2">
          <button onClick={() => setTab('bids')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${tab === 'bids' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            🎯 My Bids {bids.length > 0 && <span className="ml-1 text-xs opacity-80">({bids.length})</span>}
          </button>
          <button onClick={() => setTab('watching')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${tab === 'watching' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            ⭐ Watching {starred.length > 0 && <span className="ml-1 text-xs opacity-80">({starred.length})</span>}
          </button>
        </div>

        {/* Bids summary */}
        {tab === 'bids' && bids.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
              <div className="text-xs text-slate-500 mb-1">Total bid in</div>
              <div className="text-lg font-bold text-white">${totalBidValue.toFixed(2)}</div>
            </div>
            <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
              <div className="text-xs text-slate-500 mb-1">Est. total value</div>
              <div className="text-lg font-bold text-green-400">${totalEstValue.toFixed(0)}</div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === 'bids' ? (
          bids.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <div className="text-4xl mb-3">🎯</div>
              <div>No bids placed yet</div>
              <div className="text-xs mt-1">Click "Bid Now" on deals to track them here</div>
            </div>
          ) : (
            <div className="space-y-2">
              {bids.map(d => <DealRow key={d.id} deal={d} />)}
            </div>
          )
        ) : (
          starred.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <div className="text-4xl mb-3">⭐</div>
              <div>No starred items</div>
              <div className="text-xs mt-1">Star deals on the dashboard to add them here</div>
            </div>
          ) : (
            <div className="space-y-2">
              {starred.map(d => <DealRow key={d.id} deal={d} />)}
            </div>
          )
        )}
      </div>
    </div>
  )
}
