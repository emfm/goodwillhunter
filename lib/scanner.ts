import { AppConfig, Deal } from './types'
import { setScanStatus } from './scan-status-store'
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

  // All pages fire simultaneously
  const pageNums = Array.from({ length: pages }, (_, i) => i + 1)
  const pageResults = await Promise.all(pageNums.map(fetchPage))
  return pageResults.flat()
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
  // CTBids: two public endpoints — search + bid prices.
  // Fire all pages simultaneously; for each page fire search + bid fetch simultaneously.
  const fetchPage = async (page: number): Promise<RawItem[]> => {
    const searchRes = await fetch('https://sale.ctbids.com/services/api/v1/search/item/new/list', {
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
      signal: AbortSignal.timeout(12000),
    })
    if (!searchRes.ok) { console.warn(`  [CT] HTTP ${searchRes.status} "${keyword}" p${page}`); return [] }
    const searchData = await searchRes.json()
    const items: any[] = searchData?.data ?? []
    console.log(`  [CT] "${keyword}" p${page}: ${items.length} items`)
    if (!items.length) return []

    // Fetch bid prices in parallel with nothing (just await it here, search already done)
    const ids: number[] = items.map((i: any) => i.id)
    let bidMap: Record<number, { bid: number; bidCount: number }> = {}
    try {
      const bidRes = await fetch('https://ctbids.com/services/api/v1/buyer/auction/item/current/bid', {
        method: 'POST',
        headers: browserHeaders('ctbids'),
        body: JSON.stringify({ data: { itemIds: ids } }),
        signal: AbortSignal.timeout(10000),
      })
      if (bidRes.ok) {
        const bidData = await bidRes.json()
        for (const b of (bidData?.data ?? [])) {
          bidMap[b.itemid] = { bid: parseFloat(b.bidprice ?? 0), bidCount: parseInt(b.bidcount ?? 0) }
        }
      }
    } catch (e) { console.warn(`  [CT] bid error "${keyword}" p${page}:`, e) }

    return items.flatMap(item => {
      const endTime = (item.itemclosetime ?? '').replace(' ', 'T')
      if (isExpired(endTime)) return []
      const { bid = 0, bidCount = 0 } = bidMap[item.id] ?? {}
      if (bid > maxPrice) return []
      return [{ title: item.title ?? '', current_bid: bid,
        url: `https://www.ctbids.com/#!/estate-sale/${item.saleid}/item/${item.id}/${item.itemseourl ?? ''}`,
        image_url: item.displayimageurl ?? item.thumbnailurl ?? '',
        end_time: endTime, time_remaining: timeRemaining(endTime),
        num_bids: bidCount, source: 'CTBids' as const,
        matched_keyword: keyword, match_type: 'text' as const }]
    })
  }

  const pageNums = Array.from({ length: pages }, (_, i) => i + 1)
  const pageResults = await Promise.all(pageNums.map(fetchPage))
  return pageResults.flat()
}

// ── Value estimator (Claude-powered) ─────────────────────────────────────────
const valueCache = new Map<string, { value: number; source: string }>()

// Batch multiple titles into one Claude call to save time + cost
const VALUE_BATCH_SYSTEM = `You are an expert resale price estimator for thrift auction items — vintage video games, retro electronics, big-box PC games, trading cards, signed memorabilia, and collectibles.

Given a list of auction item titles, estimate the realistic resale value (what it would sell for on eBay in used/good condition). Be conservative — base your estimate on actual recent sold prices.

Respond ONLY with a JSON array in this exact format, one entry per title in the same order:
[{"value": 25.00, "note": "NES game, loose cart, common title"}, ...]

Rules:
- value: USD number, 0 if you have no idea or it's clearly junk/non-collectible
- note: very brief reason (one short phrase)
- Never refuse or add any other text — just the JSON array`

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
        model: 'claude-haiku-4-5-20251001', // fast + cheap for bulk value lookups
        max_tokens: 1024,
        system: VALUE_BATCH_SYSTEM,
        messages: [{ role: 'user', content: `Estimate resale values for these auction items:\n\n${prompt}` }],
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) return titles.map(() => ({ value: 0, source: '' }))
    const data = await res.json()
    const raw = data.content?.[0]?.text?.trim() ?? '[]'
    const clean = raw.replace(/^```[a-z]*\n?|\n?```$/gm, '').trim()
    const parsed = JSON.parse(clean) as Array<{ value: number; note: string }>

    return parsed.map(p => ({
      value: Math.round((Number(p.value) || 0) * 100) / 100,
      source: `Claude estimate: ${p.note ?? ''}`,
    }))
  } catch (e) {
    console.warn('Value estimation error:', e)
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
    const clean = raw.replace(/^```[a-z]*\n?|\n?```$/gm, '').trim()
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
  'Big Box PC Game': [/\bbig box\b/i, /\bpc game\b/i, /\bms-?dos\b/i, /\bcomplete in box\b/i],
  'Atari': [/\batari\b/i],
  'Console Games': [/\bnintendo\b/i, /\bnes\b/i, /\bsnes\b/i, /\bn64\b/i, /\bgame ?boy\b/i, /\bsega\b/i, /\bgenesis\b/i, /\bplaystation\b/i, /\bgamecube\b/i],
  'Signed / Autograph': [/\bsigned\b/i, /\bautograph/i],
  'Vintage Electronics': [/\bcommodore\b/i, /\bvintage\b.*\bcomputer\b/i],
  'Trading Cards': [/\bpsa\b/i, /\bbgs\b/i, /\bpokemon\b.*\bcard\b/i, /\bmagic.*gathering\b/i],
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
  if (adj <= 0 || item.current_bid <= 0) return 0

  let score = ((adj - item.current_bid) / adj) * 100

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
// Time budget for Vercel Pro (300s hard limit):
//   Crawl:           ≤ 60s   (SG + CTBids, 200–500ms between keywords)
//   Value estimation:≤ 30s   (Claude Haiku, 20-title batches, sequential)
//   Image analysis:  ≤ 120s  (Claude Sonnet, parallel 5, TOP 40 only)
//   Overhead/buffer: ≤ 30s
//   Total target:    ≤ 240s  (60s headroom vs 300s hard limit)
const MAX_IMAGE_CANDIDATES = 40   // only analyze the most promising items
const CRAWL_JITTER_MIN = 200      // ms between keyword requests — polite but not slow
const CRAWL_JITTER_MAX = 500

export async function runScan(config: AppConfig): Promise<Omit<Deal, 'id' | 'created_at' | 'updated_at' | 'notified' | 'dismissed' | 'bidded'>[]> {
  const seen = new Set<string>()
  const rawItems: RawItem[] = []
  const scanStart = Date.now()

  // ── Phase 1: Crawl — ALL keywords in parallel ────────────────────────────────
  // Each keyword fires SG + CTBids simultaneously. All keywords fire simultaneously.
  // 10 keywords sequential = ~58s. 10 keywords parallel = ~6s.
  const totalKeywords = config.keywords.length
  setScanStatus({ phase: 'crawling_sg', message: 'Scanning all keywords…', detail: `${totalKeywords} keywords × 2 sources in parallel`, progress: 5, keywordsTotal: totalKeywords, keywordsDone: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null })

  let keywordsDone = 0
  // Stagger keyword starts by 0–800ms so we don't hit both sites with
  // 10 simultaneous identical-structure requests from one IP at t=0.
  const allResults = await Promise.all(config.keywords.map(async (kw, kwIdx) => {
    await jitter(kwIdx * 80, kwIdx * 80 + 300)  // 0ms, 80–380ms, 160–460ms … staggered
    const kwItems: RawItem[] = []
    await Promise.all([
      config.sources.includes('shopgoodwill')
        ? searchShopGoodwill(kw, config.max_search_price, config.pages_per_keyword)
            .then(items => { kwItems.push(...items); console.log(`  [SG] "${kw}": ${items.length}`) })
            .catch(e => console.error(`  [SG] "${kw}" ERROR:`, e))
        : Promise.resolve(),
      config.sources.includes('ctbids')
        ? searchCTBids(kw, config.max_search_price, config.pages_per_keyword)
            .then(items => { kwItems.push(...items); console.log(`  [CT] "${kw}": ${items.length}`) })
            .catch(e => console.error(`  [CT] "${kw}" ERROR:`, e))
        : Promise.resolve(),
    ])
    keywordsDone++
    setScanStatus({ keywordsDone, progress: Math.round(5 + (keywordsDone / totalKeywords) * 35) })
    return kwItems
  }))

  // Merge, dedupe by URL
  for (const kwItems of allResults) {
    for (const item of kwItems) {
      if (!seen.has(item.url)) { seen.add(item.url); rawItems.push(item) }
    }
  }

  const sgCount = rawItems.filter(i => i.source === 'ShopGoodwill').length
  const ctCount = rawItems.filter(i => i.source === 'CTBids').length
  const crawlMs = Date.now() - scanStart
  console.log(`\n[SCAN] Crawl done in ${(crawlMs/1000).toFixed(1)}s: ${rawItems.length} total | SG: ${sgCount} | CT: ${ctCount}`)

  setScanStatus({ phase: 'estimating', message: 'Crawl complete', detail: `${rawItems.length} items — SG: ${sgCount}, CTBids: ${ctCount}`, progress: 40, sgItems: sgCount, ctItems: ctCount, itemsFound: rawItems.length })
  if (!rawItems.length) {
    setScanStatus({ phase: 'done', message: 'No items found', detail: 'Try different keywords or check source settings', progress: 100, finishedAt: new Date().toISOString() })
    return []
  }

  const candidates = rawItems.filter(i => i.title?.trim())

  // ── Phase 2: Value estimation — ALL batches in parallel ─────────────────────
  // Split into 20-title chunks, fire them ALL simultaneously via Promise.all.
  // 10 batches sequential = ~25s. 10 batches parallel = ~3s.
  console.log(`[SCAN] Estimating values for ${candidates.length} items (parallel batches)...`)
  setScanStatus({ phase: 'estimating', message: 'Estimating resale values', detail: `${candidates.length} items via Claude Haiku`, progress: 42 })
  const VALUE_BATCH = 20
  const valMap = new Map<string, { value: number; source: string }>()

  // Build batch list of only uncached titles
  const batches: Array<{ items: typeof candidates; titles: string[] }> = []
  for (let i = 0; i < candidates.length; i += VALUE_BATCH) {
    const batchItems = candidates.slice(i, i + VALUE_BATCH)
    const uncached = batchItems.filter(item => !valueCache.has(item.title))
    if (uncached.length > 0) batches.push({ items: batchItems, titles: uncached.map(i => i.title) })
    else batchItems.forEach(item => valMap.set(item.url, valueCache.get(item.title)!))
  }

  // Fire all batches at once
  await Promise.all(batches.map(async ({ items, titles }) => {
    const results = await estimateValueBatch(titles)
    let ri = 0
    for (const item of items) {
      if (!valueCache.has(item.title)) {
        valueCache.set(item.title, results[ri++] ?? { value: 0, source: '' })
      }
      valMap.set(item.url, valueCache.get(item.title) ?? { value: 0, source: '' })
    }
  }))

  const valMs = Date.now() - scanStart - crawlMs
  console.log(`[SCAN] Value estimation done in ${(valMs/1000).toFixed(1)}s`)
  setScanStatus({ progress: 60, detail: `${candidates.length} items valued` })

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

  // ── Phase 4: Image analysis — parallel batches of 5 ─────────────────────────
  const analyzeImages = config.analyze_images && !!process.env.ANTHROPIC_API_KEY
  const imgMap = new Map<string, ImageAnalysis | null>()

  if (analyzeImages && imgCandidates.length > 0) {
    const timeElapsed = Date.now() - scanStart
    const timeLeft = 280_000 - timeElapsed  // stay 20s inside the 300s limit
    const maxBatches = Math.floor(timeLeft / 4500)  // conservative 4.5s per batch of 5
    const safeCount = Math.min(imgCandidates.length, maxBatches * 5)
    const toAnalyze = imgCandidates.slice(0, safeCount)

    console.log(`[SCAN] Analyzing ${toAnalyze.length} images (${(timeElapsed/1000).toFixed(1)}s elapsed, ${(timeLeft/1000).toFixed(1)}s budget remaining)`)
    setScanStatus({ phase: 'analyzing', message: 'Analyzing photos with Claude Vision', detail: `Top ${toAnalyze.length} candidates`, progress: 62, imagesTotal: toAnalyze.length, imagesAnalyzed: 0 })

    // Fire ALL image analyses in parallel — Anthropic handles concurrent requests fine.
    // 40 sequential = ~160s. 40 parallel = ~8s (network-bound, not CPU-bound).
    setScanStatus({ imagesAnalyzed: 0, detail: `Analyzing ${toAnalyze.length} images in parallel...` })
    const imgResults = await Promise.all(
      toAnalyze.map(item => analyzeImage(item.image_url, item.title).catch(() => null))
    )
    toAnalyze.forEach((item, idx) => { imgMap.set(item.url, imgResults[idx] ?? null) })
    setScanStatus({ imagesAnalyzed: toAnalyze.length, detail: `${toAnalyze.length} images analyzed` })
    const imgMs = Date.now() - scanStart - crawlMs - valMs
    console.log(`[SCAN] Image analysis done in ${(imgMs/1000).toFixed(1)}s`)
  } else {
    console.log('[SCAN] Image analysis skipped')
    setScanStatus({ phase: 'analyzing', message: 'Skipping image analysis', detail: 'Enable in Config → Advanced', progress: 90 })
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
  setScanStatus({ phase: 'done', message: 'Scan complete', detail: `${deals.length} deals found (${withImg} with photo analysis)`, progress: 100, finishedAt: new Date().toISOString() })
  return deals
}
