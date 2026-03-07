'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AppConfig, DEFAULT_CONFIG } from '@/lib/types'

const PRESET_KEYWORDS: Record<string, string[]> = {
  'Video Games': ['atari', 'nintendo', 'sega', 'n64', 'snes', 'nes', 'gamecube', 'genesis', 'dreamcast', 'intellivision', 'colecovision', 'vectrex', 'turbografx', 'neo geo'],
  'Big Box PC': ['big box pc game', 'big box computer game', 'ms-dos game', 'sierra game', 'lucasarts', 'complete in box'],
  'Collectibles': ['signed autograph', 'psa graded', 'bgs graded', 'first edition', 'limited edition', 'prototype'],
  'Vintage Tech': ['commodore 64', 'apple ii', 'amiga', 'trs-80', 'vintage computer'],
  'Trading Cards': ['pokemon cards', 'magic the gathering', 'yu-gi-oh', 'sports cards graded'],
}

function TagInput({ values, onChange, placeholder, colorClass = '' }: {
  values: string[]
  onChange: (v: string[]) => void
  placeholder: string
  colorClass?: string
}) {
  const [input, setInput] = useState('')
  const add = () => {
    const v = input.trim().toLowerCase()
    if (v && !values.includes(v)) onChange([...values, v])
    setInput('')
  }
  return (
    <div className="border rounded-lg p-2 min-h-16 flex flex-col gap-2" style={{ background: '#0f172a', borderColor: 'var(--border2)' }}>
      <div className="flex flex-wrap gap-1.5">
        {values.map(v => (
          <span key={v} className={`tag ${colorClass}`}>
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))}
              className="text-slate-500 hover:text-red-400 transition-colors ml-1 text-sm leading-none"
            >×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={placeholder}
          className="flex-1 text-xs py-1 px-2 border-0 bg-transparent outline-none"
          style={{ fontSize: 12 }}
        />
        <button onClick={add} className="btn btn-ghost text-xs py-1 px-3">+ Add</button>
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; format: (v: number) => string
}) {
  return (
    <div className="mb-5">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-slate-400">{label}</span>
        <span className="text-sm font-bold text-sky-400">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full" style={{ accentColor: '#38bdf8' }} />
    </div>
  )
}

export default function ConfigPage() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<'keywords' | 'scoring' | 'alerts' | 'advanced'>('keywords')

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(data => {
      setConfig({ ...DEFAULT_CONFIG, ...data })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const update = (key: keyof AppConfig, value: unknown) =>
    setConfig(prev => ({ ...prev, [key]: value }))

  const saveConfig = async () => {
    setSaving(true)
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const addPreset = (name: string) => {
    const kws = PRESET_KEYWORDS[name] ?? []
    update('keywords', [...new Set([...config.keywords, ...kws])])
  }

  const TABS = [
    { id: 'keywords', label: '🔍 Keywords' },
    { id: 'scoring', label: '⚖️ Scoring' },
    { id: 'alerts', label: '📧 Alerts' },
    { id: 'advanced', label: '⚙️ Advanced' },
  ] as const

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="w-8 h-8 rounded-full border-2 border-sky-400 border-t-transparent spinner" />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header className="border-b sticky top-0 z-40 backdrop-blur-md" style={{ borderColor: 'var(--border2)', background: 'rgba(8,13,24,0.95)' }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-500 hover:text-slate-300 transition-colors text-sm">← Dashboard</Link>
            <span className="text-slate-700">|</span>
            <div className="text-base font-black text-sky-400">⚙ Config</div>
          </div>
          <button onClick={saveConfig} disabled={saving} className={`btn text-sm ${saved ? 'btn-green' : 'btn-primary'}`}>
            {saving ? '…Saving' : saved ? '✓ Saved!' : '💾 Save Changes'}
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Source toggle */}
        <div className="card p-4 mb-6 flex items-center gap-4 flex-wrap">
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Scan sources:</span>
          {['shopgoodwill', 'ctbids'].map(src => {
            const active = config.sources.includes(src)
            return (
              <button key={src} onClick={() => {
                const next = active ? config.sources.filter(s => s !== src) : [...config.sources, src]
                update('sources', next.length ? next : [src])
              }}
                className={`btn text-xs ${active ? 'btn-primary' : 'btn-ghost'}`}
              >
                {src === 'shopgoodwill' ? 'ShopGoodwill.com' : 'CTBids.com'}
              </button>
            )
          })}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b" style={{ borderColor: 'var(--border2)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
              className={`text-sm px-4 py-2.5 font-semibold transition-all border-b-2 -mb-px ${
                tab === t.id
                  ? 'border-sky-500 text-sky-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >{t.label}</button>
          ))}
        </div>

        {/* Keywords Tab */}
        {tab === 'keywords' && (
          <div className="flex flex-col gap-5">
            <div className="card p-5">
              <div className="mb-4">
                <h3 className="font-semibold text-slate-200 mb-1">Search Keywords</h3>
                <p className="text-xs text-slate-500">Items matching any of these will be evaluated. Press Enter to add.</p>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {Object.keys(PRESET_KEYWORDS).map(name => (
                  <button key={name} onClick={() => addPreset(name)}
                    className="text-xs px-3 py-1.5 rounded-md border text-slate-400 hover:text-sky-400 hover:border-sky-700 transition-all"
                    style={{ borderColor: 'var(--border2)', background: 'var(--surface)' }}
                  >+ {name}</button>
                ))}
              </div>
              <TagInput
                values={config.keywords}
                onChange={v => update('keywords', v)}
                placeholder="Type keyword and press Enter…"
              />
            </div>

            <div className="card p-5">
              <div className="mb-4">
                <h3 className="font-semibold text-slate-200 mb-1">High-Value Boosters</h3>
                <p className="text-xs text-slate-500">Items with these words in the title get a score bonus — they indicate rarer or more valuable items.</p>
              </div>
              <TagInput
                values={config.high_value_keywords}
                onChange={v => update('high_value_keywords', v)}
                placeholder="e.g. sealed, graded, signed…"
                colorClass="!bg-green-950 !text-green-400 !border-green-900"
              />
            </div>
          </div>
        )}

        {/* Scoring Tab */}
        {tab === 'scoring' && (
          <div className="card p-5">
            <Slider label="Minimum Deal Score" value={config.min_deal_score} min={20} max={90} step={5}
              onChange={v => update('min_deal_score', v)}
              format={v => `${v}/100${v >= 70 ? ' 🔥' : v >= 50 ? ' 👍' : ''}`} />
            <p className="text-xs text-slate-600 -mt-3 mb-5">70+ = great deal · 50+ = solid margin · &lt;45 = skip</p>

            <Slider label="Min Value Ratio (est. value ÷ bid)" value={config.min_value_ratio} min={1.1} max={4} step={0.1}
              onChange={v => update('min_value_ratio', Math.round(v * 10) / 10)}
              format={v => `${v.toFixed(1)}× (bid ≤${Math.round(100 / v)}% of value)`} />

            <Slider label="Max Search Price" value={config.max_search_price} min={25} max={1000} step={25}
              onChange={v => update('max_search_price', v)}
              format={v => `$${v}`} />

            <Slider label="Pages Per Keyword" value={config.pages_per_keyword} min={1} max={5} step={1}
              onChange={v => update('pages_per_keyword', v)}
              format={v => `${v} page${v > 1 ? 's' : ''} (~${v * 40} items/kw)`} />

            <div className="border-t pt-4 mt-2" style={{ borderColor: 'var(--border2)' }}>
              <h4 className="text-sm text-slate-300 font-semibold mb-3">PriceCharting API Key</h4>
              <p className="text-xs text-slate-500 mb-2">Optional — improves game/console value accuracy. Get free at pricecharting.com/api</p>
              <input
                placeholder="Leave blank to use eBay sold listings"
                value={(config as Record<string, unknown>).pricecharting_api_key as string ?? ''}
                onChange={e => update('keywords', config.keywords)} // placeholder — stored separately
              />
            </div>
          </div>
        )}

        {/* Alerts Tab */}
        {tab === 'alerts' && (
          <div className="flex flex-col gap-4">

            {/* SMS */}
            <div className="card p-5" style={{ borderColor: config.sms_enabled ? 'rgba(34,197,94,0.35)' : undefined }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-slate-200">📱 Text Message (SMS)</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Get a text the moment a hot deal lands. Uses Twilio (~$0.008/text).</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-slate-500">{config.sms_enabled ? 'ON' : 'OFF'}</span>
                  <div
                    onClick={() => update('sms_enabled', !config.sms_enabled)}
                    className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors ${config.sms_enabled ? 'bg-green-600' : 'bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${config.sms_enabled ? 'left-5' : 'left-1'}`} />
                  </div>
                </label>
              </div>
              <div className="mb-4">
                <label className="text-xs text-slate-400 mb-1 block">Your cell number (with country code)</label>
                <input type="tel" placeholder="+15551234567"
                  value={config.alert_phone}
                  onChange={e => update('alert_phone', e.target.value)} />
                <p className="text-xs text-slate-600 mt-1">US format: +1 then 10 digits</p>
              </div>
              <Slider label="SMS threshold — only text for deals above this score"
                value={config.sms_score_threshold ?? 75} min={50} max={95} step={5}
                onChange={v => update('sms_score_threshold', v)}
                format={v => `${v}/100`} />
            </div>

            <div className="card p-5" style={{ borderColor: 'rgba(34,197,94,0.2)', background: 'rgba(20,83,45,0.15)' }}>
              <h4 className="text-sm font-semibold text-green-400 mb-2">📋 Twilio SMS Setup (free trial)</h4>
              <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside">
                <li>Go to <strong className="text-slate-300">twilio.com</strong> — sign up free, no credit card for trial</li>
                <li>Verify your cell during signup (Twilio texts you a code)</li>
                <li>Console dashboard → copy your <strong className="text-slate-300">Account SID</strong> + <strong className="text-slate-300">Auth Token</strong></li>
                <li>Phone Numbers → Buy a Number → pick any US number (~$1/mo after trial)</li>
                <li>Add to Vercel env vars: <code className="text-green-400 bg-slate-900 px-1 rounded">TWILIO_ACCOUNT_SID</code>, <code className="text-green-400 bg-slate-900 px-1 rounded">TWILIO_AUTH_TOKEN</code>, <code className="text-green-400 bg-slate-900 px-1 rounded">TWILIO_FROM_NUMBER</code></li>
              </ol>
              <p className="text-xs text-slate-600 mt-2">Free trial credit covers ~1,800 texts. Then ~$1/mo for number + $0.008/text.</p>
            </div>

            {/* Email */}
            <div className="card p-5">
              <h3 className="font-semibold text-slate-200 mb-1">📧 Email Alerts</h3>
              <p className="text-xs text-slate-500 mb-4">Full HTML digest with images + AI analysis. Uses Resend (free: 3000/month).</p>
              <div className="mb-4">
                <label className="text-xs text-slate-400 mb-1 block">Send alerts to</label>
                <input type="email" placeholder="your@email.com"
                  value={config.alert_email}
                  onChange={e => update('alert_email', e.target.value)} />
              </div>
              <Slider label="Email threshold — only email deals above this score"
                value={config.alert_score_threshold ?? 70} min={40} max={95} step={5}
                onChange={v => update('alert_score_threshold', v)}
                format={v => `${v}/100`} />
              <label className="flex items-center gap-3 cursor-pointer mt-2">
                <input type="checkbox" checked={config.email_when_empty}
                  onChange={e => update('email_when_empty', e.target.checked)}
                  className="w-4 h-4" style={{ accentColor: '#38bdf8' }} />
                <span className="text-sm text-slate-400">Email even when no deals found</span>
              </label>
            </div>

            <div className="card p-5" style={{ borderColor: 'rgba(14,116,144,0.3)' }}>
              <h4 className="text-sm font-semibold text-sky-400 mb-2">📋 Resend Email Setup</h4>
              <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside">
                <li>Go to <strong className="text-slate-300">resend.com</strong> → sign up free</li>
                <li>API Keys → Create API Key → copy it</li>
                <li>Add <code className="text-sky-400 bg-slate-900 px-1 rounded">RESEND_API_KEY</code> to Vercel env vars</li>
                <li>Free tier sends from <code className="text-sky-400 bg-slate-900 px-1 rounded">onboarding@resend.dev</code> to your verified email</li>
              </ol>
            </div>

            <div className="card p-4" style={{ background: 'rgba(8,13,24,0.6)' }}>
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">How it works</div>
              <div className="space-y-2 text-xs text-slate-400">
                <div className="flex gap-3"><span className="text-green-400">📱</span><span><strong className="text-slate-300">SMS</strong> fires immediately — score ≥ {config.sms_score_threshold} — short burst with top deals + links</span></div>
                <div className="flex gap-3"><span className="text-sky-400">📧</span><span><strong className="text-slate-300">Email</strong> fires simultaneously — score ≥ {config.alert_score_threshold} — full digest with images + AI breakdown</span></div>
                <div className="flex gap-3"><span className="text-slate-500">🔁</span><span>Each deal only notifies once — no repeated pings for the same listing</span></div>
              </div>
            </div>

          </div>
        )}

        {/* Advanced Tab */}
        {tab === 'advanced' && (
          <div className="flex flex-col gap-4">
            <div className="card p-5">
              <h3 className="font-semibold text-slate-200 mb-4">Image Analysis</h3>
              <label className="flex items-center gap-3 cursor-pointer mb-3">
                <input type="checkbox" checked={config.analyze_images}
                  onChange={e => update('analyze_images', e.target.checked)}
                  className="w-4 h-4" style={{ accentColor: '#38bdf8' }} />
                <span className="text-sm text-slate-300">Enable Claude Vision image analysis</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={config.include_suspected_fakes}
                  onChange={e => update('include_suspected_fakes', e.target.checked)}
                  className="w-4 h-4" style={{ accentColor: '#38bdf8' }} />
                <span className="text-sm text-slate-400">Include items flagged as possible fakes (not recommended)</span>
              </label>
              <p className="text-xs text-slate-600 mt-3">Image analysis costs ~$0.01–0.03/run. Requires ANTHROPIC_API_KEY in Vercel env vars.</p>
            </div>

            <div className="card p-5">
              <h3 className="font-semibold text-slate-200 mb-3">Scan Schedule</h3>
              <p className="text-xs text-slate-400 mb-3">
                The scanner runs automatically via Vercel Cron. Current schedule: <strong className="text-sky-400">every 6 hours</strong>.
                To change it, edit <code className="text-sky-400 bg-slate-900 px-1 rounded">vercel.json</code> and redeploy.
              </p>
              <div className="bg-slate-950 rounded p-3 text-xs font-mono text-slate-400 border" style={{ borderColor: 'var(--border2)' }}>
                {`"crons": [{ "path": "/api/scan", "schedule": "0 */6 * * *" }]`}
              </div>
              <p className="text-xs text-slate-600 mt-2">Note: Vercel Hobby allows 1 cron/day. Pro allows every hour. For more frequent scans on Hobby, use cron-job.org to call /api/scan with your CRON_SECRET header.</p>
            </div>

            <div className="card p-5 border-red-900/30" style={{ borderColor: 'rgba(127,29,29,0.4)' }}>
              <h3 className="font-semibold text-red-400 mb-3">Danger Zone</h3>
              <button
                onClick={async () => {
                  if (!confirm('Delete all dismissed deals? This cannot be undone.')) return
                  // Could add a delete-dismissed API endpoint
                  alert('To delete deals, go to your Supabase dashboard and run: DELETE FROM deals WHERE dismissed = true')
                }}
                className="btn text-xs" style={{ background: '#3a1515', color: '#f87171', border: '1px solid #f871712a' }}
              >🗑 Clear Dismissed Deals</button>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button onClick={saveConfig} disabled={saving} className={`btn text-sm ${saved ? 'btn-green' : 'btn-primary'}`}>
            {saving ? '…Saving' : saved ? '✓ Saved!' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
