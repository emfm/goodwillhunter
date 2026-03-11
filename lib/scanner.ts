import { AppConfig, Deal } from './types'
import { setScanStatus } from './scan-status-store'
import { isStopRequested, resetStopFlag } from './scan-stop-store'
import { createCipheriv } from 'crypto'

// ── Stealth helpers ───────────────────────────────────────────────────────────
// Randomized delays and headers so scans look like normal browser traffic.

// Random int between min and max (inclusive)
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// Random delay in a range — call between every request
function jitter(minMs: number, maxMs: number) {
  return new Promise(r => setTimeout(r, randInt(minMs, maxMs)))
}

// Anthropic API concurrency limiter — max 3 simultaneous calls to avoid 429s.
// With 50+ items we'd fire 3+ concurrent batches otherwise.
function makeAnthropicLimiter() {
  const MAX = 8
  let running = 0
  const queue: Array<() => void> = []
  return async function<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= MAX) await new Promise<void>(r => queue.push(r))
    running++
    try { return await fn() }
    finally { running--; if (queue.length) queue.shift()!() }
  }
}
const anthropicLimit = makeAnthropicLimiter()

// Current browser fingerprints (Chrome 131/132 + Firefox 133 — dominant in early 2026)
const BROWSERS = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ch: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    platform: '"Windows"', mobile: '?0',
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    ch: '"Google Chrome";v="132", "Chromium";v="132", "Not_A Brand";v="24"',
    platform: '"Windows"', mobile: '?0',
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ch: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    platform: '"macOS"', mobile: '?0',
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    ch: '"Google Chrome";v="132", "Chromium";v="132", "Not_A Brand";v="24"',
    platform: '"macOS"', mobile: '?0',
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    ch: null, platform: null, mobile: null,  // Firefox doesn't send sec-ch-ua
  },
]

function randomUA() { return BROWSERS[randInt(0, BROWSERS.length - 1)].ua }

// Full browser header set — what a real Chrome/Firefox sends for a JSON API call
// from a React SPA (same-site XHR to the API subdomain)
function browserHeaders(site: 'shopgoodwill' | 'ctbids'): Record<string, string> {
  const b = BROWSERS[randInt(0, BROWSERS.length - 1)]
  const isFF = !b.ch
  const headers: Record<string, string> = {
    'accept': 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'user-agent': b.ua,
    'origin': site === 'shopgoodwill' ? 'https://shopgoodwill.com' : 'https://ctbids.com',
    'referer': site === 'shopgoodwill' ? 'https://shopgoodwill.com/' : 'https://ctbids.com/',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'connection': 'keep-alive',
  }
  if (!isFF && b.ch) {
    headers['sec-ch-ua'] = b.ch
    headers['sec-ch-ua-mobile'] = b.mobile!
    headers['sec-ch-ua-platform'] = b.platform!
  }
  return headers
}

// ── ShopGoodwill auth ─────────────────────────────────────────────────────────
// SG encrypts credentials with AES-256-CBC before sending to login endpoint.
// Key and IV are hardcoded in their JS bundle (secretKeyURL + fixed IV).
const SG_KEY = Buffer.from('6696D2E6F042FEC4D6E3F32AD541143B', 'utf8') // 32 bytes
const SG_IV  = Buffer.from('0000000000000000', 'utf8')                  // 16 bytes

function encryptForSG(text: string): string {
  const cipher = createCipheriv('aes-256-cbc', SG_KEY, SG_IV)
  let enc = cipher.update(text, 'utf8', 'base64')
  enc += cipher.final('base64')
  return encodeURIComponent(enc)
}

let _sgToken: string | null = null
let _sgTokenExpiry = 0

async function getSGToken(): Promise<string | null> {
  const now = Date.now()
  if (_sgToken && now < _sgTokenExpiry) return _sgToken

  const user = (process.env.SHOPGOODWILL_USERNAME ?? '').trim()
  const pass = (process.env.SHOPGOODWILL_PASSWORD ?? '').trim()
  if (!user || !pass) {
    console.log('No SHOPGOODWILL_USERNAME/PASSWORD set — ShopGoodwill search disabled.')
    return null
  }

  try {
    const res = await fetch('https://buyerapi.shopgoodwill.com/api/SignIn/Login', {
      method: 'POST',
      headers: browserHeaders('shopgoodwill'),
      body: JSON.stringify({
        userName: encryptForSG(user),
        password: encryptForSG(pass),
        browser: 'chrome',
        appVersion: '0ac533a6087baed7',
        remember: false,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.warn('ShopGoodwill login failed, status:', res.status)
      return null
    }
    const data = await res.json()
    if (!data?.accessToken) {
      console.warn('ShopGoodwill login returned no token:', data?.message ?? JSON.stringify(data).slice(0, 100))
      return null
    }
    _sgToken = data.accessToken
    _sgTokenExpiry = now + 23 * 60 * 60 * 1000 // tokens last ~24h, refresh at 23h
    console.log('ShopGoodwill login OK')
    return _sgToken
  } catch (e) {
    console.warn('ShopGoodwill login error:', e)
    return null
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawItem {
  title: string
  current_bid: number
  url: string
  image_url: string
  end_time: string
  time_remaining: string
  num_bids: number
  source: 'ShopGoodwill' | 'CTBids'
  matched_keyword: string
  match_type: 'text' | 'image'
}

interface ImageAnalysis {
  condition: string
  condition_score: number
  completeness: string
  is_authentic: boolean | null
  value_multiplier: number
  flags: string[]
  positives: string[]
  summary: string
}

// ── Time helpers ──────────────────────────────────────────────────────────────
function timeRemaining(endTimeStr: string): string {
  try {
    const end = new Date(endTimeStr)
    const now = new Date()
    const diffMs = end.getTime() - now.getTime()
    if (diffMs < 0) return 'ended'
    const d = Math.floor(diffMs / 86400000)
    const h = Math.floor((diffMs % 86400000) / 3600000)
    const m = Math.floor((diffMs % 3600000) / 60000)
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`
  } catch {
    return ''
  }
}

function isExpired(endTimeStr: string): boolean {
  try {
    if (!endTimeStr) return false
    const end = new Date(endTimeStr)
    // SG/CTBids return times without timezone — they're US Eastern (UTC-5/4).
    // Vercel runs UTC, so naive parse makes Eastern times look 4-5h early.
    // Add a 6h grace window to avoid dropping live auctions due to TZ mismatch.
    // Items truly ended days ago will still be filtered; closing-today ones won't.
    const SIX_HOURS = 6 * 60 * 60 * 1000
    return end.getTime() + SIX_HOURS < Date.now()
  } catch {
    return false
  }
}

// ── ShopGoodwill ──────────────────────────────────────────────────────────────
// CONFIRMED from bundle analysis (chunk 540.f273fdc0838e96d1.js):
//   getProducts(h) posts long-form keys directly to Search/ItemListing
//   JWT interceptor has NO allowedDomains → no auth header added for cross-origin
//   Search is effectively PUBLIC — no Authorization header needed or expected
//   Abbreviated keys (st, hp, etc.) crash the server with HTTP 500
//   Long-form keys + no auth = HTTP 200 with real results
async function searchShopGoodwill(keyword: string, maxPrice: number, pages: number): Promise<RawItem[]> {
  const d = new Date()
  const todayStr = `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`

  const fetchPage = async (page: number): Promise<RawItem[]> => {
    const res = await fetch('https://buyerapi.shopgoodwill.com/api/Search/ItemListing', {
      method: 'POST',
      headers: browserHeaders('shopgoodwill'),
      body: JSON.stringify({
        searchText: keyword,
        selectedGroup: '', selectedCategoryIds: '', selectedSellerIds: '',
        lowPrice: 0, highPrice: maxPrice,
        searchBuyNowOnly: '', searchPickupOnly: false, searchNoPickupOnly: false,
        searchOneCentShippingOnly: false, searchDescriptions: false,
        searchClosedAuctions: false, closedAuctionEndingDate: todayStr,
        closedAuctionDaysBack: 7, searchCanadaShipping: false,
        searchInternationalShippingOnly: false, sortColumn: 1,
        page, pageSize: 40, sortDescending: false, savedSearchId: 0,
        useBuyerPrefs: false, searchUSOnlyShipping: false, categoryLevelNo: 1,
        catIds: '', partNumber: '', isWeddingCatagory: false,
        isMultipleCategoryIds: false, isFromHeaderMenuTab: false,
        layout: 'grid', isFromHomePage: '',
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) { console.warn(`SG HTTP ${res.status} "${keyword}" p${page}`); return [] }
    const data = await res.json()
    const items: any[] = data?.searchResults?.items ?? []
    console.log(`  [SG] "${keyword}" p${page}: ${items.length} items`)
    return items.flatMap(item => {
      const endTime = item.endTime ?? item.closingDate ?? item.endDate ?? ''
      if (isExpired(endTime)) return []
      const bid = parseFloat(item.currentPrice ?? item.minimumBid ?? 0)
      if (bid > maxPrice) return []
      return [{ title: item.title ?? '', current_bid: bid,
        url: `https://shopgoodwill.com/item/${item.itemId}`,
        image_url: item.imageURL ?? item.galleryURL ?? '',
        end_time: endTime, time_remaining: timeRemaining(endTime),
        num_bids: parseInt(item.numBids ?? item.numberOfBids ?? 0),
        source: 'ShopGoodwill' as const, matched_keyword: keyword, match_type: 'text' as const }]
    })
  }

  // Pages are sequential — parallel page fetches look like a scraper
  const results: RawItem[] = []
  for (let p = 1; p <= pages; p++) {
    const pageItems = await fetchPage(p)
    results.push(...pageItems)
    if (pageItems.length < 40) break  // no more pages
    if (p < pages) await jitter(500, 1000)
  }
  return results
}

// ── CTBids auth ───────────────────────────────────────────────────────────────
// Buyer login (confirmed from chunk 21/ctbids.com bundle, onSignin handler):
//   POST https://ctbids.com/services/api/v1/buyer/auth/token
//   Body: {data: {username: email, password: btoa(pass), "keep-user-logged-in": false}}
//   No auth header needed
//   Returns: {accessToken, refreshToken} at top level of response
// NOTE: admin.ctbids.com/admin/auth/token is the SELLER portal — rejects buyer accounts
// Search: POST https://sale.ctbids.com/services/api/v1/search/item/search/list
// Headers: Authorization: Bearer <accessToken>
let _ctToken: string | null = null
let _ctTokenExpiry = 0

async function getCTToken(): Promise<string | null> {
  const now = Date.now()
  if (_ctToken && now < _ctTokenExpiry) return _ctToken

  const user = (process.env.CTBIDS_USERNAME ?? '').trim()
  const pass = (process.env.CTBIDS_PASSWORD ?? '').trim()
  if (!user || !pass) {
    console.log('No CTBIDS_USERNAME/PASSWORD set — CTBids search disabled.')
    return null
  }
  // Debug: log redacted credential info to catch whitespace/case issues
  console.log(`CTBids login attempt: user="${user}" (${user.length} chars), pass length=${pass.length}`)

  try {
    const res = await fetch('https://ctbids.com/services/api/v1/buyer/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://ctbids.com',
        'Referer': 'https://ctbids.com/',
        'User-Agent': randomUA(),
      },
      // CTBids buyer frontend btoa()-encodes the password (confirmed chunk 21.a3eea968, onSignin)
      body: JSON.stringify({ data: { username: user.toLowerCase(), password: Buffer.from(pass).toString('base64'), 'keep-user-logged-in': false } }),
      signal: AbortSignal.timeout(15000),
    })

    const data = await res.json()

    // Buyer endpoint returns: {accessToken, refreshToken} at the top level
    const access = data?.accessToken ?? data?.data?.accessToken ?? data?.access
    if (!access) {
      const errMsg = typeof data?.message === 'object'
        ? data.message?.CBMSW?.message ?? JSON.stringify(data.message).slice(0, 120)
        : data?.message ?? JSON.stringify(data).slice(0, 120)
      console.warn('CTBids login failed:', errMsg)
      return null
    }

    _ctToken = access
    // CTBids JWTs typically expire in 1hr — refresh at 55m
    _ctTokenExpiry = now + 55 * 60 * 1000
    console.log('CTBids login OK')
    return _ctToken
  } catch (e) {
    console.warn('CTBids login error:', e)
    return null
  }
}

// ── CTBids ────────────────────────────────────────────────────────────────────
async function searchCTBids(keyword: string, maxPrice: number, pages: number): Promise<RawItem[]> {
  // Helper: fetch with one automatic retry on timeout/5xx
  const fetchWithRetry = async (url: string, opts: RequestInit, tag: string): Promise<Response | null> => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, opts)
        if (res.ok) return res
        const body = await res.text().catch(() => '')
        console.warn(`  [CT] ${tag} HTTP ${res.status} (attempt ${attempt}): ${body.slice(0, 120)}`)
        if (res.status < 500) return res  // 4xx — don't retry
        await jitter(1500, 2500)
      } catch (e: any) {
        console.warn(`  [CT] ${tag} attempt ${attempt} error: ${e?.message ?? e}`)
        if (attempt < 2) await jitter(2000, 3000)
      }
    }
    return null
  }

  const fetchPage = async (page: number): Promise<RawItem[]> => {
    const searchRes = await fetchWithRetry(
      'https://sale.ctbids.com/services/api/v1/search/item/new/list',
      {
        method: 'POST',
        headers: browserHeaders('ctbids'),
        body: JSON.stringify({
          sort: [{ field: 'itemclosetime', direction: 'asc' }],
          page: { size: 40, number: page },
          field: ['id', 'title', 'itemclosetime', 'displayimageurl', 'thumbnailurl',
                  'itemseourl', 'saleid', 'city', 'state', 'isshippable', 'category', 'categoryGroup'],
          filter: [
            { field: 'salestatus', value: 'Started', op: '=', join: 'AND' },
            { field: 'itemstatus',  value: 'Ready',   op: '=', join: 'AND' },
            { field: 'title',       value: keyword,   op: 'LIKE', join: 'AND' },
          ],
        }),
        signal: AbortSignal.timeout(25000),
      },
      `search "${keyword}" p${page}`
    )
    if (!searchRes) return []

    const searchData = await searchRes.json().catch(() => null)
    if (!searchData) { console.warn(`  [CT] bad JSON for "${keyword}" p${page}`); return [] }

    const items: any[] = searchData?.data ?? []
    console.log(`  [CT] "${keyword}" p${page}: ${items.length} raw items (status: ${searchData?.status})`)
    if (!items.length) return []

    // Bid prices
    const ids: number[] = items.map((i: any) => i.id)
    let bidMap: Record<number, { bid: number; bidCount: number }> = {}
    const bidRes = await fetchWithRetry(
      'https://ctbids.com/services/api/v1/buyer/auction/item/current/bid',
      {
        method: 'POST',
        headers: browserHeaders('ctbids'),
        body: JSON.stringify({ data: { itemIds: ids } }),
        signal: AbortSignal.timeout(20000),
      },
      `bids "${keyword}" p${page}`
    )
    if (bidRes) {
      const bidData = await bidRes.json().catch(() => null)
      for (const b of (bidData?.data ?? [])) {
        bidMap[b.itemid] = { bid: parseFloat(b.bidprice ?? 0), bidCount: parseInt(b.bidcount ?? 0) }
      }
      console.log(`  [CT] "${keyword}" p${page}: got ${Object.keys(bidMap).length} bid prices`)
    }

    let expiredCount = 0, overPriceCount = 0
    const kept = items.flatMap(item => {
      const endTime = (item.itemclosetime ?? '').replace(' ', 'T')
      if (isExpired(endTime)) { expiredCount++; return [] }
      const { bid = 0, bidCount = 0 } = bidMap[item.id] ?? {}
      if (bid > maxPrice) { overPriceCount++; return [] }
      return [{ title: item.title ?? '', current_bid: bid,
        url: `https://ctbids.com/estate-sale/${item.saleid}/item/${item.id}`,
        image_url: item.displayimageurl ?? item.thumbnailurl ?? '',
        end_time: endTime, time_remaining: timeRemaining(endTime),
        num_bids: bidCount, source: 'CTBids' as const,
        matched_keyword: keyword, match_type: 'text' as const }]
    })
    console.log(`  [CT] "${keyword}" p${page}: ${kept.length} kept (${expiredCount} expired, ${overPriceCount} over $${maxPrice})`)
    return kept
  }

  const results: RawItem[] = []
  for (let p = 1; p <= pages; p++) {
    const pageItems = await fetchPage(p)
    results.push(...pageItems)
    if (pageItems.length < 40) break
    if (p < pages) await jitter(500, 1000)
  }
  return results
}

// ── Value estimator (Claude-powered) ─────────────────────────────────────────
const valueCache = new Map<string, { value: number; source: string }>()

// ── PriceCharting real-price scraper ─────────────────────────────────────────
// PriceCharting has actual market data for video games, retro electronics,
// and TCG cards — way more accurate than Claude's memory-based estimates.
// We use it first; fall back to Claude Haiku for autographs/misc/no-match.

function cleanQueryForPricecharting(title: string): string {
  let t = title
  // Strip auction noise: lot descriptions, weights, condition qualifiers
  t = t.replace(/(lot of \d+|\d+\s*(loose|pcs|pieces|items|cards)|lot of|bundle with|bundle|not tested|untested|as-is|as is|for parts|near mint|nm|very good|vg\+?|good|poor|incomplete|complete in box|cib)/gi, '')
  t = t.replace(/\d+\.?\d*\s*(lb|lbs|oz)/gi, '')
  // Cut at comma or dash — everything after is usually "and more" filler
  t = t.replace(/[,\-–—].*$/, '')
  // Remove COA/auth markers (we handle autographs via Claude)
  t = t.replace(/(signed|autographed?|autograph|coa|jsa|psa|beckett|authenticated?)/gi, '')
  t = t.replace(/\s+/g, ' ').trim().slice(0, 60)
  return t
}

function wordOverlap(a: string, b: string): number {
  const wa = new Set((a.toLowerCase().match(/\w{3,}/g) ?? []))
  const wb = new Set((b.toLowerCase().match(/\w{3,}/g) ?? []))
  if (!wa.size || !wb.size) return 0
  let overlap = 0
  wa.forEach(w => { if (wb.has(w)) overlap++ })
  return overlap / Math.max(wa.size, wb.size)
}

async function lookupPricecharting(title: string): Promise<{ value: number; source: string } | null> {
  const query = cleanQueryForPricecharting(title)
  if (query.length < 5) return null

  try {
    const url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null

    const html = await res.text()
    // Parse table rows: <tr id="..."> contains title + js-price spans
    const rowRe = /<tr[^>]*id="[^"]+"[^>]*>([\s\S]*?)<\/tr>/g
    let match: RegExpExecArray | null
    const rows: Array<{ title: string; price: number }> = []

    while ((match = rowRe.exec(html)) !== null && rows.length < 5) {
      const row = match[1]
      const titleM = row.match(/class="title"[^>]*>\s*<a[^>]*>([^<]+)/)
      const priceM = row.match(/class="[^"]*js-price[^"]*">\$([0-9,]+\.?[0-9]*)/)
      if (titleM && priceM) {
        const price = parseFloat(priceM[1].replace(/,/g, ''))
        if (!isNaN(price) && price > 0) {
          rows.push({ title: titleM[1].trim(), price })
        }
      }
    }

    if (!rows.length) return null

    // Only trust the result if the top hit actually matches our query
    const topMatch = rows[0]
    const sim = wordOverlap(query, topMatch.title)
    if (sim < 0.25) {
      // No good match — try second result
      if (rows.length > 1 && wordOverlap(query, rows[1].title) >= 0.25) {
        return { value: rows[1].price, source: `PriceCharting: ${rows[1].title.slice(0, 40)}` }
      }
      return null
    }

    return { value: topMatch.price, source: `PriceCharting: ${topMatch.title.slice(0, 40)}` }
  } catch {
    return null
  }
}

// Batch multiple titles into one Claude call to save time + cost

const VALUE_BATCH_SYSTEM = `You are an expert resale price estimator for thrift auction items. You specialize in: vintage video games, retro electronics, signed memorabilia/autographs, trading cards, comics, big-box PC games, and collectibles.

For each item title, estimate the realistic eBay SOLD price (not listing price — actual recent sales).

CRITICAL RULES FOR SIGNATURES/AUTOGRAPHS:
- A signed item with COA (Certificate of Authenticity) from PSA, JSA, Beckett, Radtke, or similar = dramatically higher value
- Muhammad Ali signed anything with COA = $500-5000+ depending on item
- Beatles/band signed items with COA = $1000-10000+
- NFL/NBA Hall of Famers signed with COA = $100-500+
- Unknown or minor celebrities = much lower, $20-100
- "Signed" without COA mention = assume lower value (authenticity risk)
- Lot of signed balls/items by multiple players = value each separately then sum

CRITICAL RULES FOR ART/PRINTS:
- "Signed & Numbered" limited edition prints by known artists (G. Harvey, Bev Doolittle, etc.) = $50-500
- Original paintings vs prints: originals are worth 5-20x more
- Unknown artist signatures = low value ($10-50)

CRITICAL RULES FOR GAMES:
- CIB (Complete In Box) = 2-3x loose cart value
- Sealed/NIB = 5-20x loose value
- Nintendo 64, GameCube, SNES games vary wildly by title — use specific knowledge
- Common NES carts = $5-15, rare ones = $50-500+

Respond ONLY with a JSON array, one entry per title, same order:
[{"value": 25.00, "note": "brief reason"}, ...]

- value: USD number (0 only if genuinely worthless junk with no collector appeal)
- note: one short phrase explaining your estimate
- Never add any other text — just the JSON array`

async function estimateValueBatch(titles: string[]): Promise<Array<{ value: number; source: string }>> {
  if (!titles.length) return []
  if (!process.env.ANTHROPIC_API_KEY) return titles.map(() => ({ value: 0, source: '' }))

  try {
    const prompt = titles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,  // 20 items × ~40 tokens each = ~800 tokens; 4096 gives plenty of room
        system: VALUE_BATCH_SYSTEM,
        messages: [{ role: 'user', content: `Estimate resale values for these auction items:\n\n${prompt}` }],
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (res.status === 429) {
      console.warn('[VALUE] 429 rate limit — waiting 3s before retry')
      await new Promise(r => setTimeout(r, 3000))
      const retry = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4096, system: VALUE_BATCH_SYSTEM, messages: [{ role: 'user', content: 'Estimate resale values for these auction items:\n\n' + prompt }] }),
        signal: AbortSignal.timeout(30000),
      })
      if (!retry.ok) { console.error('[VALUE] Retry failed:', retry.status); return titles.map(() => ({ value: 0, source: '' })) }
      const retryData = await retry.json()
      const retryRaw = (retryData.content?.[0]?.text ?? '').trim()
      if (retryRaw) {
        try {
          const retryClean = retryRaw.replace(/^```[a-z]*/gm, '').replace(/```$/gm, '').trim()
          const retryParsed = JSON.parse(retryClean) as Array<{ value: number; note: string }>
          return retryParsed.map(p => ({ value: Math.round((Number(p.value) || 0) * 100) / 100, source: p.note ? 'Claude: ' + p.note : 'Claude estimate' }))
        } catch { return titles.map(() => ({ value: 0, source: '' })) }
      }
      return titles.map(() => ({ value: 0, source: '' }))
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[VALUE] API error ${res.status}:`, errText.slice(0, 200))
      return titles.map(() => ({ value: 0, source: '' }))
    }
    const data = await res.json()
    const raw = data.content?.[0]?.text?.trim() ?? ''
    if (!raw) { console.error('[VALUE] Empty response from Claude'); return titles.map(() => ({ value: 0, source: '' })) }

    // Strip markdown fences if present
    const clean = raw.replace(/^```[a-z]*/gm, '').replace(/```$/gm, '').trim()

    // If JSON got truncated, patch it so we get partial results rather than zero
    let toParse = clean
    if (!toParse.endsWith(']')) {
      // Close off the last incomplete object and the array
      const lastComma = toParse.lastIndexOf(',')
      const lastBrace = toParse.lastIndexOf('}')
      toParse = (lastBrace > lastComma ? toParse.slice(0, lastBrace + 1) : toParse.slice(0, lastComma)) + ']'
    }

    const parsed = JSON.parse(toParse) as Array<{ value: number; note: string }>
    console.log(`[VALUE] Got ${parsed.length}/${titles.length} estimates`)

    // Pad with zeros if we got fewer entries than titles (truncation)
    const padded = Array.from({ length: titles.length }, (_, i) => parsed[i] ?? { value: 0, note: 'no estimate' })
    return padded.map(p => ({
      value: Math.round((Number(p.value) || 0) * 100) / 100,
      source: p.note ? `Claude: ${p.note}` : 'Claude estimate',
    }))
  } catch (e) {
    console.error('[VALUE] Estimation error:', e)
    return titles.map(() => ({ value: 0, source: '' }))
  }
}

async function estimateValue(title: string): Promise<{ value: number; source: string }> {
  if (valueCache.has(title)) return valueCache.get(title)!
  const results = await estimateValueBatch([title])
  const result = results[0] ?? { value: 0, source: '' }
  valueCache.set(title, result)
  return result
}

// ── Claude Vision image analysis ──────────────────────────────────────────────
const imageCache = new Map<string, ImageAnalysis>()

const IMAGE_SYSTEM = `You are an expert collector appraising vintage video games, big-box PC games, retro electronics, signed memorabilia, and trading cards from auction photos. Respond ONLY with a JSON object — no markdown, no text.

Schema:
{"condition":"Sealed"|"Mint"|"Good"|"Fair"|"Poor"|"Unknown","condition_score":<0-10>,"completeness":"Complete in Box"|"Cart/Disc Only"|"Partial"|"Unknown","is_authentic":true|false|null,"value_multiplier":<0.3-2.5>,"flags":["red flags"],"positives":["positives"],"summary":"1-2 sentence assessment"}

value_multiplier: 2.0-2.5=sealed/exceptional, 1.3-1.9=complete+good, 1.0-1.2=good/standard, 0.7-0.9=minor missing, 0.4-0.6=cart only/worn, 0.1-0.3=damaged/reproduction`

async function analyzeImage(imageUrl: string, title: string): Promise<ImageAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY || !imageUrl) return null
  if (imageCache.has(imageUrl)) return imageCache.get(imageUrl)!

  try {
    const imgRes = await fetch(imageUrl, {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://shopgoodwill.com/',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!imgRes.ok) return null
    const buffer = await imgRes.arrayBuffer()
    const b64 = Buffer.from(buffer).toString('base64')
    const ct = (imgRes.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
    const mediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(ct) ? ct : 'image/jpeg'

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: IMAGE_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: `Analyze this auction listing image: "${title}"\n\nCheck: condition, completeness (CIB/sealed/loose), authenticity signals, damage, notable positives. Return only JSON.` },
          ],
        }],
      }),
      signal: AbortSignal.timeout(25000),
    })

    if (!res.ok) return null
    const data = await res.json()
    const raw = data.content?.[0]?.text?.trim() ?? ''
    const clean = raw.replace(/^```[a-z]*/gm, '').replace(/```$/gm, '').trim()
    const parsed = JSON.parse(clean) as ImageAnalysis
    imageCache.set(imageUrl, parsed)
    return parsed
  } catch (e) {
    console.warn('Image analysis error:', e)
    return null
  }
}

// ── Scorer ────────────────────────────────────────────────────────────────────
const CATEGORIES: Record<string, RegExp[]> = {
  'Signatures':      [/\bsigned\b/i, /\bautograph/i, /\bcoa\b/i, /\bjsa\b/i, /\bbeckett\b/i, /\bpsa\s*dna\b/i],
  'Comics':          [/\bcomic\b/i, /\bmarvel\b/i, /\bdc comics\b/i, /\bgraphic novel\b/i, /\bcomic book\b/i, /\bcomic lot\b/i],
  'Computer Games':  [/\bbig box\b/i, /\bpc game\b/i, /\bms-?dos\b/i, /\bwindows game\b/i, /\bcomputer game\b/i, /\batari\b/i, /\bcommodore\b/i, /\bapple ii\b/i, /\btrs-?80\b/i,
                      /\bnintendo\b/i, /\bnes\b/i, /\bsnes\b/i, /\bn64\b/i, /\bgame ?boy\b/i, /\bgame ?cube\b/i, /\bwii\b/i,
                      /\bsega\b/i, /\bgenesis\b/i, /\bmega drive\b/i, /\bmaster system\b/i, /\bdream ?cast\b/i,
                      /\bplaystation\b/i, /\bps[1-5]\b/i, /\bxbox\b/i, /\bvideo game\b/i, /\bgame cartridge\b/i,
                      /\bintellivision\b/i, /\bcolecovision\b/i, /\bvectrex\b/i, /\bvirtual boy\b/i, /\b3do\b/i],
  'Trading Cards':   [/\bpokemon\b/i, /\bmagic.*gathering\b/i, /\bmtg\b/i, /\bsports card\b/i, /\bbaseball card\b/i,
                      /\bfootball card\b/i, /\bbasketball card\b/i, /\btrading card\b/i, /\bpsa\b/i, /\bbgs\b/i,
                      /\byugioh\b/i, /\byu-gi-oh\b/i, /\bdragon ball\b/i, /\bone piece card\b/i],
  'Vintage Electronics': [/\bvintage\b.*\belectron/i, /\bvintage\b.*\bcomputer\b/i, /\bvintage\b.*\bcalculator\b/i,
                           /\bamiga\b/i, /\btrs-?80\b/i, /\bapple ii\b/i, /\bvintage\b.*\bcamera\b/i],
}

function categorize(title: string): string {
  for (const [cat, patterns] of Object.entries(CATEGORIES)) {
    if (patterns.some(p => p.test(title))) return cat
  }
  return 'General'
}

function scoreDeal(
  item: RawItem,
  estVal: number,
  img: ImageAnalysis | null,
  config: AppConfig
): number {
  const adj = estVal * (img?.value_multiplier ?? 1)

  // Base score: ROI if we have a value estimate; otherwise a signal-only score
  // so items don't all show 0 while estimates are loading or missing
  let score: number
  if (adj > 0 && item.current_bid > 0) {
    score = ((adj - item.current_bid) / adj) * 100
  } else if (item.current_bid > 0) {
    // No estimate yet — base on bid signals only, capped at 40
    score = 20
    score += item.num_bids < 3 ? 10 : 0  // low competition
    if (config.high_value_keywords.some(w => item.title.toLowerCase().includes(w.toLowerCase()))) score += 10
    return Math.min(40, Math.round(score))
  } else {
    return 0
  }

  if (img) {
    score += (img.condition_score - 5)
    if (img.is_authentic === false) score -= 30
    if (img.condition === 'Sealed') score += 15
    if (img.condition === 'Poor') score -= 10
  }

  try {
    const hrs = (new Date(item.end_time).getTime() - Date.now()) / 3600000
    if (hrs > 2 && hrs < 24) score += 5
  } catch {/* skip */}

  score += item.num_bids < 3 ? 5 : item.num_bids > 10 ? -5 : 0

  if (config.high_value_keywords.some(w => item.title.toLowerCase().includes(w.toLowerCase()))) {
    score += 10
  }

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10))
}

// ── Main scan ─────────────────────────────────────────────────────────────────
// CRAWL is fully sequential — one keyword at a time, one source at a time.
// This is intentional: SG and CTBids will ban you for burst traffic.
// Everything AFTER the crawl (value estimation, image analysis) is fully
// parallel since it only hits Anthropic's API, not the auction sites.
const MAX_IMAGE_CANDIDATES = 15

export async function runScan(config: AppConfig): Promise<Omit<Deal, 'id' | 'created_at' | 'updated_at' | 'notified' | 'dismissed' | 'bidded'>[]> {
  resetStopFlag()
  const seen = new Set<string>()
  const rawItems: RawItem[] = []
  const scanStart = Date.now()
  const scanId = `scan_${scanStart}`
  const scanStartedAt = new Date().toISOString()

  // ── Phase 1: Crawl — sequential, polite ───────────────────────────────────
  const totalKeywords = config.keywords.length
  await setScanStatus({ phase: 'crawling_sg', message: 'Scanning keywords…', detail: `0 / ${totalKeywords} keywords`, progress: 5, keywordsTotal: totalKeywords, keywordsDone: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null })

  for (let kwIdx = 0; kwIdx < config.keywords.length; kwIdx++) {
    const kw = config.keywords[kwIdx]
    const pct = Math.round(5 + (kwIdx / totalKeywords) * 35)

    if (config.sources.includes('shopgoodwill')) {
      await setScanStatus({ phase: 'crawling_sg', message: `ShopGoodwill: "${kw}"`, detail: `keyword ${kwIdx + 1} / ${totalKeywords}`, currentKeyword: kw, keywordsDone: kwIdx, progress: pct })
      try {
        const sgPagesThisKw = (Date.now() - scanStart) > 120_000 ? 1 : (config.pages_per_keyword ?? 2)
        const items = await searchShopGoodwill(kw, config.max_search_price, sgPagesThisKw)
        const fresh = items.filter(i => !seen.has(i.url))
        fresh.forEach(i => { seen.add(i.url); rawItems.push(i) })
        console.log(`  [SG] "${kw}": ${items.length} (${fresh.length} new)`)
      } catch (e) { console.error(`  [SG] "${kw}" ERROR:`, e) }
      await jitter(400, 900)  // pause between SG and CTBids for same keyword
    }

    if (config.sources.includes('ctbids')) {
      await setScanStatus({ phase: 'crawling_ct', message: `CTBids: "${kw}"`, detail: `keyword ${kwIdx + 1} / ${totalKeywords}`, currentKeyword: kw, keywordsDone: kwIdx, progress: pct })
      try {
        const ctPagesThisKw = (Date.now() - scanStart) > 150_000 ? 1 : (config.pages_per_keyword ?? 2)
        const items = await searchCTBids(kw, config.max_search_price, ctPagesThisKw)
        const fresh = items.filter(i => !seen.has(i.url))
        fresh.forEach(i => { seen.add(i.url); rawItems.push(i) })
        console.log(`  [CT] "${kw}": ${items.length} (${fresh.length} new)`)
      } catch (e) { console.error(`  [CT] "${kw}" ERROR:`, e) }
    }

    await setScanStatus({ keywordsDone: kwIdx + 1, itemsFound: rawItems.length, sgItems: rawItems.filter(i => i.source === 'ShopGoodwill').length, ctItems: rawItems.filter(i => i.source === 'CTBids').length })
    if (isStopRequested()) { console.log('[SCAN] Stopped after keyword', kwIdx + 1); break }
    // Pause between keywords — looks like a human browsing
    if (kwIdx < config.keywords.length - 1) await jitter(400, 900)
  }

  const sgCount = rawItems.filter(i => i.source === 'ShopGoodwill').length
  const ctCount = rawItems.filter(i => i.source === 'CTBids').length
  const crawlMs = Date.now() - scanStart
  console.log(`\n[SCAN] Crawl done in ${(crawlMs/1000).toFixed(1)}s: ${rawItems.length} total | SG: ${sgCount} | CT: ${ctCount}`)

  await setScanStatus({ phase: 'estimating', message: 'Crawl complete', detail: `${rawItems.length} items — SG: ${sgCount}, CTBids: ${ctCount}`, progress: 40, sgItems: sgCount, ctItems: ctCount, itemsFound: rawItems.length })
  if (!rawItems.length) {
    await setScanStatus({ phase: 'done', message: 'No items found', detail: 'Try different keywords or check source settings', progress: 100, finishedAt: new Date().toISOString() })
    return []
  }

  const allItems = rawItems.filter(i => i.title?.trim())

  // ── Cap candidates to avoid timeout ─────────────────────────────────────────
  // Sort by keyword match quality first: items with high_value_keywords bubble up
  // then sort by bid price (sweet spot $1–$50 = best ROI potential)
  const MAX_ESTIMATE = 250
  const hvkSet = new Set((config.high_value_keywords ?? []).map(w => w.toLowerCase()))
  const ranked = [...allItems].sort((a, b) => {
    const aHvk = hvkSet.size && [...hvkSet].some(w => a.title.toLowerCase().includes(w)) ? 1 : 0
    const bHvk = hvkSet.size && [...hvkSet].some(w => b.title.toLowerCase().includes(w)) ? 1 : 0
    if (aHvk !== bHvk) return bHvk - aHvk
    // prefer mid-range bids ($1–$80) over free or very expensive
    const aScore = a.current_bid >= 1 && a.current_bid <= 80 ? 1 : 0
    const bScore = b.current_bid >= 1 && b.current_bid <= 80 ? 1 : 0
    return bScore - aScore
  })
  const candidates = ranked.slice(0, MAX_ESTIMATE)
  console.log(`[SCAN] Capped to ${candidates.length}/${allItems.length} candidates for estimation`)

  // ── Phase 2: Value estimation ────────────────────────────────────────────────
  // Step 1: PriceCharting in parallel for all items (real sold data, free, fast)
  // Step 2: Claude Haiku for anything PriceCharting couldn't match (max 3 concurrent)
  console.log(`[SCAN] Looking up ${candidates.length} items (PriceCharting + Claude Haiku)...`)
  await setScanStatus({ phase: 'estimating', message: 'Looking up real market prices', detail: `${candidates.length} of ${allItems.length} items`, progress: 42 })

  const valMap = new Map<string, { value: number; source: string }>()

  // Step 1: PriceCharting — all items in parallel (just web scraping, fast)
  const pcResults = await Promise.all(
    candidates.map(item =>
      valueCache.has(item.title)
        ? Promise.resolve(valueCache.get(item.title)!)
        : lookupPricecharting(item.title)
    )
  )

  const needsHaiku: typeof candidates = []
  candidates.forEach((item, idx) => {
    const pc = pcResults[idx]
    if (pc && pc.value > 0) {
      valueCache.set(item.title, pc)
      valMap.set(item.url, pc)
    } else {
      needsHaiku.push(item)
    }
  })

  const pcHits = candidates.length - needsHaiku.length
  console.log(`[SCAN] PriceCharting: ${pcHits} hits, ${needsHaiku.length} need Claude estimate`)
  await setScanStatus({ detail: `${pcHits} real prices found, estimating ${needsHaiku.length} via AI...`, progress: 52 })

  // Step 2: Claude Haiku for the rest — batches of 20, all parallel
  if (needsHaiku.length > 0) {
    const VALUE_BATCH = 20
    const batches: Array<{ items: typeof candidates; titles: string[] }> = []
    for (let i = 0; i < needsHaiku.length; i += VALUE_BATCH) {
      const batchItems = needsHaiku.slice(i, i + VALUE_BATCH)
      const uncached = batchItems.filter(item => !valueCache.has(item.title))
      if (uncached.length > 0) batches.push({ items: batchItems, titles: uncached.map(c => c.title) })
      else batchItems.forEach(item => valMap.set(item.url, valueCache.get(item.title)!))
    }
    // Max 3 concurrent Anthropic calls — prevents 429 rate limit errors
    // Hard time budget: stop sending new batches if we're past 160s
    await Promise.all(batches.map(({ items, titles }) =>
      anthropicLimit(async () => {
        if (Date.now() - scanStart > 160_000) {
          console.warn('[SCAN] Estimation time budget exceeded, skipping batch')
          items.forEach(item => valMap.set(item.url, { value: 0, source: '' }))
          return
        }
        const results = await estimateValueBatch(titles)
        let ri = 0
        for (const item of items) {
          if (!valueCache.has(item.title)) {
            valueCache.set(item.title, results[ri++] ?? { value: 0, source: '' })
          }
          valMap.set(item.url, valueCache.get(item.title) ?? { value: 0, source: '' })
        }
      })
    ))
  }

  const valMs = Date.now() - scanStart - crawlMs
  const realPrices = [...valMap.values()].filter(v => v.source.startsWith('PriceCharting')).length
  console.log(`[SCAN] Valuation done in ${(valMs/1000).toFixed(1)}s — ${realPrices} real comps, ${valMap.size - realPrices} AI estimates`)
  await setScanStatus({ progress: 60, detail: `${realPrices} real market prices + ${valMap.size - realPrices} AI estimates`, realPrices, aiPrices: valMap.size - realPrices })

  // ── Phase 3: Pre-score without images → pick TOP candidates for vision ──────
  // This ensures we only spend image API budget on items most likely to be deals.
  // Pre-score = (est_value - bid) / est_value × 100, clamped to [0,100]
  const prescored = candidates.map(item => {
    const { value } = valMap.get(item.url) ?? { value: 0 }
    const bid = item.current_bid
    const prescore = (value > 0 && bid > 0) ? Math.max(0, ((value - bid) / value) * 100) : 0
    return { item, value, prescore }
  })
  // Sort by prescore desc, take top MAX_IMAGE_CANDIDATES
  prescored.sort((a, b) => b.prescore - a.prescore)
  const imgCandidates = prescored.slice(0, MAX_IMAGE_CANDIDATES).map(p => p.item)
  console.log(`[SCAN] Image analysis: top ${imgCandidates.length} of ${candidates.length} candidates selected`)

  if (isStopRequested()) { console.log('[SCAN] Stopped before image analysis'); return [] }

  // ── Phase 4: Image analysis — parallel batches of 5 ─────────────────────────
  const analyzeImages = config.analyze_images && !!process.env.ANTHROPIC_API_KEY
  const imgMap = new Map<string, ImageAnalysis | null>()

  if (analyzeImages && imgCandidates.length > 0) {
    const timeElapsed = Date.now() - scanStart
    const timeLeft = 220_000 - timeElapsed  // 40s safety buffer before 300s limit
    // With 8 concurrent and ~2s per image, estimate 2.5s per image to be safe
    const safeCount = Math.min(imgCandidates.length, Math.max(0, Math.floor(timeLeft / 2500)))
    const toAnalyze = imgCandidates.slice(0, safeCount)

    console.log(`[SCAN] Analyzing ${toAnalyze.length} images (${(timeElapsed/1000).toFixed(1)}s elapsed, ${(timeLeft/1000).toFixed(1)}s left)`)
    await setScanStatus({ phase: 'analyzing', message: 'Analyzing photos with Claude Vision', detail: `Top ${toAnalyze.length} candidates`, progress: 62, imagesTotal: toAnalyze.length, imagesAnalyzed: 0 })

    // Max 3 concurrent image analyses — same Anthropic rate limit applies
    await setScanStatus({ imagesAnalyzed: 0, detail: `Analyzing ${toAnalyze.length} images...` })
    const imgResults = await Promise.all(
      toAnalyze.map(item => anthropicLimit(() => analyzeImage(item.image_url, item.title).catch(() => null)))
    )
    toAnalyze.forEach((item, idx) => { imgMap.set(item.url, imgResults[idx] ?? null) })
    await setScanStatus({ imagesAnalyzed: toAnalyze.length, detail: `${toAnalyze.length} images analyzed` })
    const imgMs = Date.now() - scanStart - crawlMs - valMs
    console.log(`[SCAN] Image analysis done in ${(imgMs/1000).toFixed(1)}s`)
  } else {
    console.log('[SCAN] Image analysis skipped')
    await setScanStatus({ phase: 'analyzing', message: 'Skipping image analysis', detail: 'Enable in Config → Advanced', progress: 90 })
  }

  // ── Phase 5: Build final deal rows ─────────────────────────────────────────
  const deals: Omit<Deal, 'id' | 'created_at' | 'updated_at' | 'notified' | 'dismissed' | 'bidded'>[] = []

  for (const item of candidates) {
    const { value: estVal, source: valSource } = valMap.get(item.url) ?? { value: 0, source: '' }
    const img = imgMap.get(item.url) ?? null
    const adjValue = Math.round(estVal * (img?.value_multiplier ?? 1) * 100) / 100
    const score = scoreDeal(item, estVal, img, config)

    deals.push({
      title:            item.title,
      current_bid:      item.current_bid,
      estimated_value:  estVal,
      adjusted_value:   adjValue,
      deal_score:       score,
      url:              item.url,
      image_url:        item.image_url,
      source:           item.source,
      end_time:         item.end_time,
      time_remaining:   item.time_remaining,
      num_bids:         item.num_bids,
      category:         categorize(item.title),
      matched_keyword:  item.matched_keyword,
      match_type:       item.match_type,
      starred:          false,
      first_seen_at:    scanStartedAt,
      scan_id:          scanId,
      description:      null,
      value_source:     valSource,
      condition:        img?.condition ?? null,
      condition_score:  img?.condition_score ?? null,
      completeness:     img?.completeness ?? null,
      is_authentic:     img?.is_authentic ?? null,
      value_multiplier: img?.value_multiplier ?? 1,
      flags:            img?.flags ?? [],
      positives:        img?.positives ?? [],
      img_summary:      img?.summary ?? null,
    })
  }

  const totalMs = Date.now() - scanStart
  const withImg = deals.filter(d => d.img_summary).length
  const withScore = deals.filter(d => d.deal_score > 0).length
  console.log(`\n[SCAN] Done in ${(totalMs/1000).toFixed(1)}s — ${deals.length} deals | ${withImg} with image analysis | ${withScore} scored`)
  await setScanStatus({ phase: 'done', message: 'Scan complete', detail: `${deals.length} deals found (${withImg} with photo analysis)`, progress: 100, finishedAt: new Date().toISOString(), scanId })
  return deals
}

// ── Exported phase functions (used by split scan routes) ──────────────────────

export interface RawItemRow {
  url: string
  title: string
  current_bid: number
}

export async function crawlSources(config: AppConfig, scanId: string): Promise<{ items: RawItem[] }> {
  resetStopFlag()
  const seen = new Set<string>()
  const rawItems: RawItem[] = []
  const totalKeywords = config.keywords.length

  await setScanStatus({ phase: 'crawling_sg', message: 'Searching sources…', detail: `0 / ${totalKeywords} keywords`, progress: 5, keywordsTotal: totalKeywords, keywordsDone: 0, itemsFound: 0, sgItems: 0, ctItems: 0, startedAt: new Date().toISOString() })

  for (let kwIdx = 0; kwIdx < config.keywords.length; kwIdx++) {
    const kw = config.keywords[kwIdx]
    const pct = Math.round(5 + (kwIdx / totalKeywords) * 28)

    if (config.sources.includes('shopgoodwill')) {
      await setScanStatus({ phase: 'crawling_sg', currentKeyword: kw, keywordsDone: kwIdx, progress: pct, message: `SG: "${kw}"`, detail: `${kwIdx + 1}/${totalKeywords}` })
      try {
        const items = await searchShopGoodwill(kw, config.max_search_price, config.pages_per_keyword ?? 2)
        items.filter(i => !seen.has(i.url)).forEach(i => { seen.add(i.url); rawItems.push(i) })
        await setScanStatus({ sgItems: rawItems.filter(i => i.source === 'ShopGoodwill').length, itemsFound: rawItems.length })
      } catch (e) { console.error(`[SG] "${kw}" error:`, e) }
    }

    if (config.sources.includes('ctbids')) {
      await setScanStatus({ phase: 'crawling_ct', currentKeyword: kw, message: `CT: "${kw}"`, detail: `${kwIdx + 1}/${totalKeywords}` })
      try {
        const items = await searchCTBids(kw, config.max_search_price, config.pages_per_keyword ?? 2)
        items.filter(i => !seen.has(i.url)).forEach(i => { seen.add(i.url); rawItems.push(i) })
        await setScanStatus({ ctItems: rawItems.filter(i => i.source === 'CTBids').length, itemsFound: rawItems.length })
      } catch (e) { console.error(`[CT] "${kw}" error:`, e) }
    }

    await setScanStatus({ keywordsDone: kwIdx + 1 })
    if (isStopRequested()) break
    if (kwIdx < config.keywords.length - 1) await jitter(400, 900)
  }

  console.log(`[CRAWL] ${rawItems.length} items (SG: ${rawItems.filter(i=>i.source==='ShopGoodwill').length}, CT: ${rawItems.filter(i=>i.source==='CTBids').length})`)
  return { items: rawItems }
}

const SIGNATURE_PATTERNS = [/\bsigned\b/i, /\bautograph/i, /\bcoa\b/i, /\bjsa\b/i, /\bbeckett\b/i, /\bpsa\s*dna\b/i, /\bradtke\b/i]

async function estimateSignatureWithSearch(item: RawItemRow): Promise<{ value: number; source: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { value: 0, source: '' }
  try {
    const prompt = 'Search eBay sold listings for this signed/autographed item and give me a realistic resale value.\n\nItem: "' + item.title + '"\n\nFind recent eBay SOLD prices. Consider COA authenticity, who signed it, and item type.\n\nReply in this exact JSON format only: {"value": 125.00, "note": "brief reason"}'
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return { value: 0, source: '' }
    const data = await res.json()
    const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    const match = text.match(/\{"value"[^{}]*\}|\{[^{}]*"value"[^{}]*\}/)
    if (!match) return { value: 0, source: '' }
    const parsed = JSON.parse(match[0])
    return { value: Math.round((Number(parsed.value) || 0) * 100) / 100, source: 'Web: ' + (parsed.note ?? '') }
  } catch (e) {
    console.error('[SIGNATURE] search failed:', e)
    return { value: 0, source: '' }
  }
}

export async function estimateValuesForScan(
  items: RawItemRow[],
  _scanId: string
): Promise<{ updates: Array<{ url: string; value: number; source: string }>; realPrices: number; aiPrices: number }> {
  const updates: Array<{ url: string; value: number; source: string }> = []
  let realPrices = 0

  const allSigItems = items.filter(i => SIGNATURE_PATTERNS.some(p => p.test(i.title)))
  // Cap Sonnet+search at 20 to stay within 300s budget; remainder falls through to Haiku
  const MAX_SONNET_SIGS = 20
  const signatureItems = allSigItems.slice(0, MAX_SONNET_SIGS)
  const sigOverflow = allSigItems.slice(MAX_SONNET_SIGS)
  const regularItems = items.filter(i => !SIGNATURE_PATTERNS.some(p => p.test(i.title)))
  console.log('[ESTIMATE] ' + items.length + ' items: ' + signatureItems.length + ' sigs (Sonnet), ' + sigOverflow.length + ' sigs (Haiku), ' + regularItems.length + ' regular')

  // Top 20 signatures: Sonnet + web search, batches of 3
  if (signatureItems.length > 0) {
    await setScanStatus({ detail: 'Researching top ' + signatureItems.length + ' signed items…', progress: 42 })
    for (let i = 0; i < signatureItems.length; i += 3) {
      const batch = signatureItems.slice(i, i + 3)
      const results = await Promise.all(batch.map(item => estimateSignatureWithSearch(item)))
      batch.forEach((item, idx) => {
        const r = results[idx]
        updates.push({ url: item.url, value: r.value, source: r.source })
        if (r.value > 0) realPrices++
      })
      const done = Math.min(i + 3, signatureItems.length)
      await setScanStatus({ detail: 'Signed: ' + done + '/' + signatureItems.length + ' researched…', progress: Math.round(42 + (done / items.length) * 18) })
      if (i + 3 < signatureItems.length) await new Promise(r => setTimeout(r, 800))
    }
  }

  // Regular items + overflow sigs: PriceCharting then Haiku
  const needsPC = [...regularItems, ...sigOverflow]
  const pcResults = await Promise.all(needsPC.map(i => lookupPricecharting(i.title).catch(() => null)))
  const needsHaiku: RawItemRow[] = []
  needsPC.forEach((item, idx) => {
    const pc = pcResults[idx]
    if (pc && pc.value > 0) {
      updates.push({ url: item.url, value: pc.value, source: pc.source })
      realPrices++
    } else {
      needsHaiku.push(item)
    }
  })

  await setScanStatus({ detail: realPrices + ' real comps, estimating ' + needsHaiku.length + ' via AI…', progress: 62 })

  const VALUE_BATCH = 20
  for (let i = 0; i < needsHaiku.length; i += VALUE_BATCH) {
    const batch = needsHaiku.slice(i, i + VALUE_BATCH)
    try {
      const results = await estimateValueBatch(batch.map(item => item.title))
      batch.forEach((item, idx) => {
        updates.push({ url: item.url, value: results[idx]?.value ?? 0, source: results[idx]?.source ?? '' })
      })
    } catch (e) {
      console.error('[ESTIMATE] Haiku batch ' + i + ' failed:', e)
      batch.forEach(item => updates.push({ url: item.url, value: 0, source: '' }))
    }
    await setScanStatus({ detail: updates.length + '/' + items.length + ' priced…', progress: Math.round(62 + (updates.length / items.length) * 18) })
    if (i + VALUE_BATCH < needsHaiku.length) await new Promise(r => setTimeout(r, 500))
  }

  const aiPrices = needsHaiku.length
  return { updates, realPrices, aiPrices }
}

export async function finalizeDeals(scanId: string, config: AppConfig): Promise<Record<string, unknown>[]> {
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: rawItems } = await db.from('raw_scan_items').select('*').eq('scan_id', scanId)
  if (!rawItems?.length) return []

  const scanStartedAt = new Date().toISOString()

  // Pre-score to pick image candidates
  const prescored = rawItems.map((item: any) => {
    const val = item.estimated_value ?? 0
    const bid = item.current_bid ?? 0
    const prescore = val > 0 && bid > 0 ? Math.max(0, ((val - bid) / val) * 100) : 0
    return { item, prescore }
  }).sort((a: any, b: any) => b.prescore - a.prescore)

  const toAnalyze = prescored.slice(0, 15).map((p: any) => p.item)
  const imgMap = new Map<string, ImageAnalysis | null>()

  if (config.analyze_images && process.env.ANTHROPIC_API_KEY && toAnalyze.length > 0) {
    await setScanStatus({ phase: 'analyzing', message: 'Analyzing photos…', detail: `Top ${toAnalyze.length} items`, progress: 70, imagesTotal: toAnalyze.length, imagesAnalyzed: 0 })
    const results = await Promise.all(toAnalyze.map((item: any) => anthropicLimit(() => analyzeImage(item.image_url, item.title).catch(() => null))))
    toAnalyze.forEach((item: any, idx: number) => imgMap.set(item.url, results[idx] ?? null))
    await setScanStatus({ imagesAnalyzed: toAnalyze.length, progress: 88 })
  }

  const deals: Record<string, unknown>[] = []
  for (const item of rawItems as any[]) {
    const img = imgMap.get(item.url) ?? null
    const estVal = item.estimated_value ?? 0
    const adjValue = Math.round(estVal * (img?.value_multiplier ?? 1) * 100) / 100
    const score = scoreDeal(item, estVal, img, config)

    deals.push({
      title: item.title, current_bid: item.current_bid,
      estimated_value: estVal, adjusted_value: adjValue, deal_score: score,
      url: item.url, image_url: item.image_url, source: item.source,
      end_time: item.end_time, time_remaining: item.time_remaining, num_bids: item.num_bids,
      category: categorize(item.title), matched_keyword: item.matched_keyword,
      match_type: item.match_type ?? 'text', description: null,
      value_source: item.value_source ?? '',
      condition: img?.condition ?? null, condition_score: img?.condition_score ?? null,
      completeness: img?.completeness ?? null, is_authentic: img?.is_authentic ?? null,
      value_multiplier: img?.value_multiplier ?? 1,
      flags: img?.flags ?? [], positives: img?.positives ?? [], img_summary: img?.summary ?? null,
      starred: false, first_seen_at: scanStartedAt, scan_id: scanId,
    })
  }

  return deals
}
