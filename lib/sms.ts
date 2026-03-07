import { Deal } from './types'

/**
 * Sends SMS alerts via Twilio.
 * No SDK needed — Twilio's REST API works with plain fetch.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID  — from console.twilio.com
 *   TWILIO_AUTH_TOKEN   — from console.twilio.com
 *   TWILIO_FROM_NUMBER  — your Twilio phone number e.g. +15551234567
 *   ALERT_PHONE         — your cell number e.g. +15559876543
 */

function buildSmsBody(deals: Deal[]): string {
  const hot = deals.filter(d => d.deal_score >= 80)
  const good = deals.filter(d => d.deal_score >= 70 && d.deal_score < 80)

  const lines: string[] = ['🎯 Goodwill Hunter Alert\n']

  const topDeals = hot.length ? hot : good
  const limit = topDeals.slice(0, 3) // SMS has 160-char limit per segment; keep it tight

  for (const d of limit) {
    const roi = d.current_bid > 0
      ? Math.round(((d.adjusted_value - d.current_bid) / d.current_bid) * 100)
      : 0
    const cond = d.condition && d.condition !== 'Unknown' ? ` [${d.condition}]` : ''
    lines.push(
      `🔥 Score ${d.deal_score}/100${cond}`,
      `${d.title.slice(0, 55)}${d.title.length > 55 ? '…' : ''}`,
      `Bid: $${d.current_bid.toFixed(2)} → Est: $${d.adjusted_value.toFixed(2)} (+${roi}%)`,
      `⏱ ${d.time_remaining} left`,
      d.url,
      ''
    )
  }

  if (deals.length > 3) {
    lines.push(`+ ${deals.length - 3} more deal(s) — check your dashboard`)
  }

  return lines.join('\n').trim()
}

export async function sendSmsAlert(deals: Deal[], toPhone?: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  const to = toPhone ?? process.env.ALERT_PHONE

  if (!sid || !token || !from || !to) {
    console.log('SMS skipped — Twilio env vars not configured')
    return
  }

  if (!deals.length) return

  const body = buildSmsBody(deals)
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
  const credentials = Buffer.from(`${sid}:${token}`).toString('base64')

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
    })

    const data = await res.json()
    if (!res.ok) {
      console.error('Twilio error:', data.message ?? data)
    } else {
      console.log(`SMS sent → ${to} (sid: ${data.sid})`)
    }
  } catch (e) {
    console.error('SMS send failed:', e)
  }
}
