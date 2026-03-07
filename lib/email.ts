import { Resend } from 'resend'
import { Deal } from './types'

const CONDITION_COLORS: Record<string, [string, string]> = {
  Sealed: ['#14532d', '#22c55e'],
  Mint: ['#14532d', '#4ade80'],
  Good: ['#1a3a1a', '#86efac'],
  Fair: ['#3a2e00', '#fbbf24'],
  Poor: ['#3a1515', '#f87171'],
}

function badge(condition: string | null): string {
  if (!condition || condition === 'Unknown') return ''
  const [bg, fg] = CONDITION_COLORS[condition] ?? ['#1e293b', '#94a3b8']
  return `<span style="background:${bg};color:${fg};border:1px solid ${fg}55;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${condition}</span>`
}

function dealCard(d: Deal): string {
  const sc = d.deal_score >= 80 ? '#22c55e' : d.deal_score >= 60 ? '#f59e0b' : '#94a3b8'
  const roi = d.current_bid > 0 ? Math.round(((d.adjusted_value - d.current_bid) / d.current_bid) * 100) : 0
  const mult = d.value_multiplier
  const adjNote = Math.abs(mult - 1) > 0.05 ? ` <span style="font-size:11px;color:#64748b">${mult > 1 ? '↑' : '↓'} img adj</span>` : ''

  const flagsHtml = d.flags.map(f => `<div style="color:#fca5a5;font-size:11px;">⚠ ${f}</div>`).join('')
  const posHtml = d.positives.map(p => `<div style="color:#86efac;font-size:11px;">✓ ${p}</div>`).join('')
  const analysisSection = d.img_summary ? `
    <tr><td colspan="2" style="padding:6px 0 10px;">
      <div style="background:#0b1220;border:1px solid #1e3a5f;border-radius:6px;padding:10px 12px;">
        <div style="font-size:10px;font-weight:700;color:#38bdf8;letter-spacing:0.5px;margin-bottom:5px;">🤖 AI IMAGE ANALYSIS</div>
        <div style="font-size:12px;color:#94a3b8;font-style:italic;margin-bottom:6px;">"${d.img_summary}"</div>
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="50%" valign="top">${posHtml}</td>
          <td width="50%" valign="top">${flagsHtml}</td>
        </tr></table>
        <div style="font-size:11px;color:#475569;margin-top:4px;">
          ${d.completeness ?? ''} · Value adj: <strong style="color:${mult >= 1.2 ? '#22c55e' : mult >= 0.8 ? '#fbbf24' : '#f87171'}">×${mult.toFixed(1)}</strong>
        </div>
      </div>
    </td></tr>` : ''

  return `
  <tr><td style="padding:14px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="110" valign="top">
          <img src="${d.image_url}" width="100" height="80" style="object-fit:cover;border-radius:6px;border:1px solid #334155;display:block;" />
          <div style="margin-top:4px;">${badge(d.condition)}</div>
        </td>
        <td style="padding-left:14px;" valign="top">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px;">
            <a href="${d.url}" style="color:#38bdf8;text-decoration:none;">${d.title.slice(0, 85)}</a>
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:7px;">${d.source} · ${d.category} · ⏱ ${d.time_remaining} · ${d.num_bids} bid(s)</div>
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-right:16px;"><div style="font-size:10px;color:#64748b;text-transform:uppercase;">Bid</div><div style="font-size:18px;font-weight:700;color:#f8fafc;">$${d.current_bid.toFixed(2)}</div></td>
              <td style="padding-right:16px;"><div style="font-size:10px;color:#64748b;text-transform:uppercase;">Est. Value</div><div style="font-size:18px;font-weight:700;color:#22c55e;">$${d.adjusted_value.toFixed(2)}${adjNote}</div></td>
              <td style="padding-right:16px;"><div style="font-size:10px;color:#64748b;text-transform:uppercase;">ROI</div><div style="font-size:18px;font-weight:700;color:#f59e0b;">+${roi}%</div></td>
              <td><div style="font-size:10px;color:#64748b;text-transform:uppercase;">Score</div><div style="font-size:18px;font-weight:700;color:${sc};">${d.deal_score}/100</div></td>
            </tr>
          </table>
        </td>
      </tr>
      ${analysisSection}
    </table>
  </td></tr>
  <tr><td style="border-bottom:1px solid #1e293b;padding-bottom:4px;"></td></tr>`
}

function buildEmailHtml(deals: Deal[], runTime: string): string {
  const great = deals.filter(d => d.deal_score >= 70)
  const good = deals.filter(d => d.deal_score < 70)
  const analyzed = deals.filter(d => d.img_summary).length

  const greatRows = great.length
    ? great.map(dealCard).join('')
    : `<tr><td style="padding:16px;color:#475569;text-align:center;">No exceptional deals this run.</td></tr>`

  const goodSection = good.length ? `
    <tr><td style="padding:20px 0 0;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#f59e0b;border-bottom:1px solid #f59e0b33;padding-bottom:8px;">👀 Worth a Look</div>
    </td></tr>
    <table width="100%" cellpadding="0" cellspacing="0">${good.map(dealCard).join('')}</table>` : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;padding:28px 0;">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="background:#1a2332;border-radius:12px;overflow:hidden;border:1px solid #2a3a50;">
  <tr><td style="background:linear-gradient(135deg,#1e3a5f,#0a0f1e);padding:24px 28px;">
    <div style="font-size:22px;font-weight:800;color:#38bdf8;">🎯 Goodwill Hunter</div>
    <div style="font-size:12px;color:#64748b;margin-top:3px;">${runTime} · ${deals.length} deal(s) · ${analyzed} image(s) analyzed</div>
  </td></tr>
  <tr><td style="padding:20px 28px 0;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#22c55e;border-bottom:1px solid #22c55e33;padding-bottom:8px;">🔥 Great Deals — Score 70+</div>
  </td></tr>
  <tr><td style="padding:0 28px;">
    <table width="100%" cellpadding="0" cellspacing="0">${greatRows}</table>
    ${goodSection}
  </td></tr>
  <tr><td style="padding:20px 28px;border-top:1px solid #1e293b;">
    <div style="font-size:11px;color:#2a3a50;text-align:center;">Goodwill Hunter · AI vision by Claude · Estimates only — always verify before bidding</div>
  </td></tr>
</table>
</td></tr></table></body></html>`
}

export async function sendAlertEmail(deals: Deal[], to: string): Promise<void> {
  if (!process.env.RESEND_API_KEY || !to || !deals.length) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const runTime = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const hotDeals = deals.filter(d => d.deal_score >= 70)
  const subject = hotDeals.length
    ? `🔥 ${hotDeals.length} hot deal(s) — Goodwill Hunter`
    : `🎯 ${deals.length} deal(s) found — Goodwill Hunter`

  await resend.emails.send({
    from: process.env.RESEND_FROM ?? 'Goodwill Hunter <onboarding@resend.dev>',
    to,
    subject,
    html: buildEmailHtml(deals, runTime),
  })
}
