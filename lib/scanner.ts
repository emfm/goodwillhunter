import { AppConfig, Deal } from './types'
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

// Rotate through realistic Chrome UA strings
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
]
function randomUA() {
  return USER_AGENTS[randInt(0, USER_AGENTS.length - 1)]
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
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://shopgoodwill.com',
        'Referer': 'https://shopgoodwill.com/',
        'User-Agent': randomUA(),
        'Accept': 'application/json, text/plain, */*',
      },
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
    return new Date(endTimeStr) < new Date()
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
  const results: RawItem[] = []
  // Random cold-start delay so cron runs don't hit at identical timestamps
  await jitter(500, 4000)
  // Today's date in M/d/yyyy for closedAuctionEndingDate field
  const d = new Date()
  const todayStr = `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`
  for (let page = 1; page <= pages; page++) {
    try {
      const res = await fetch('https://buyerapi.shopgoodwill.com/api/Search/ItemListing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://shopgoodwill.com',
          'Referer': 'https://shopgoodwill.com/',
          'User-Agent': randomUA(),
        },
        // Long-form keys confirmed from productListRequestModel in chunk 607.57ed78687d76d20e.js
        // Abbreviated keys (st, hp, etc.) cause HTTP 500 — the API does NOT accept them
        body: JSON.stringify({
          searchText: keyword,
          selectedGroup: '',
          selectedCategoryIds: '',
          selectedSellerIds: '',
          lowPrice: 0,
          highPrice: maxPrice,
          searchBuyNowOnly: '',
          searchPickupOnly: false,
          searchNoPickupOnly: false,
          searchOneCentShippingOnly: false,
          searchDescriptions: false,
          searchClosedAuctions: false,
          closedAuctionEndingDate: todayStr,
          closedAuctionDaysBack: 7,
          searchCanadaShipping: false,
          searchInternationalShippingOnly: false,
          sortColumn: 1,
          page,
          pageSize: 40,
          sortDescending: false,
          savedSearchId: 0,
          useBuyerPrefs: false,
          searchUSOnlyShipping: false,
          categoryLevelNo: 1,
          catIds: '',
          partNumber: '',
          isWeddingCatagory: false,
          isMultipleCategoryIds: false,
          isFromHeaderMenuTab: false,
          layout: 'grid',
          isFromHomePage: '',
        }),
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.warn(`ShopGoodwill search HTTP ${res.status} for "${keyword}" p${page} — ${errText.slice(0, 120)}`)
        break
      }
      const data = await res.json()
      // Response: {searchResults: {items: [...], itemCount: N}, maxTotalRecords, ...}
      const items: any[] = data?.searchResults?.items ?? []
      if (page === 1) console.log(`  SG "${keyword}" p${page}: ${items.length} items`)
      else console.log(`  SG "${keyword}" p${page}: ${items.length} items`)
      if (!items.length) break
      for (const item of items) {
        const endTime = item.endTime ?? item.closingDate ?? item.endDate ?? ''
        if (isExpired(endTime)) continue
        const bid = parseFloat(item.currentPrice ?? item.minimumBid ?? 0)
        if (bid > maxPrice) continue
        results.push({
          title: item.title ?? '',
          current_bid: bid,
          url: `https://shopgoodwill.com/item/${item.itemId}`,
          image_url: item.imageURL ?? item.galleryURL ?? '',
          end_time: endTime,
          time_remaining: timeRemaining(endTime),
          num_bids: parseInt(item.numBids ?? item.numberOfBids ?? 0),
          source: 'ShopGoodwill',
          matched_keyword: keyword,
        })
      }
      await jitter(1200, 3500)
    } catch (e) {
      console.warn(`ShopGoodwill error (${keyword}):`, e)
      break
    }
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
  const token = await getCTToken()
  if (!token) return []

  const results: RawItem[] = []
  // Random cold-start delay — stagger CTBids from ShopGoodwill requests
  await jitter(1000, 6000)
  for (let page = 1; page <= pages; page++) {
    try {
      const res = await fetch('https://sale.ctbids.com/services/api/v1/search/item/search/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Origin': 'https://ctbids.com',
          'Referer': 'https://ctbids.com/',
          'User-Agent': randomUA(),
        },
        body: JSON.stringify({
          keyword,
          pageNumber: page,
          pageSize: 40,
          sortOrder: 'ClosingDateASC',
        }),
        signal: AbortSignal.timeout(12000),
      })

      if (!res.ok) {
        console.warn(`CTBids search HTTP ${res.status} for "${keyword}" p${page}`)
        if (res.status === 401) { _ctToken = null }
        break
      }

      const data = await res.json()
      if (data?.status === 'failed') {
        console.warn(`CTBids search failed: ${data.message}`)
        if (data.message?.includes('Invalid') || data.message?.includes('expired')) {
          _ctToken = null
        }
        break
      }

      // Response may be wrapped: {data: [...]} or {data: {itemList: [...]}} etc.
      const items: any[] = data?.data?.itemList
        ?? data?.data?.items
        ?? data?.data
        ?? data?.itemList
        ?? data?.items
        ?? []

      console.log(`  CTBids "${keyword}" p${page}: ${items.length} items`)
      if (!items.length) break

      for (const item of items) {
        const endTime = (item.closingDate ?? item.closingTime ?? item.endDate ?? '').slice(0, 19)
        if (isExpired(endTime)) continue
        const bid = parseFloat(item.currentBid ?? item.currentPrice ?? item.startBid ?? 0)
        if (bid > maxPrice) continue
        results.push({
          title: item.title ?? item.name ?? item.itemName ?? '',
          current_bid: bid,
          url: `https://www.ctbids.com/#!/item/detail/${item.itemId ?? item.id}`,
          image_url: item.imageURL ?? item.thumbnailURL ?? item.primaryImage ?? '',
          end_time: endTime,
          time_remaining: timeRemaining(endTime),
          num_bids: parseInt(item.bidCount ?? item.numberOfBids ?? 0),
          source: 'CTBids',
          matched_keyword: keyword,
        })
      }
      await jitter(1200, 3500)
    } catch (e) {
      console.warn(`CTBids error (${keyword}):`, e)
      break
    }
  }
  return results
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
      headers: { 'User-Agent': randomUA() },
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
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export async function runScan(config: AppConfig): Promise<Omit<Deal, 'id' | 'created_at' | 'updated_at' | 'notified' | 'dismissed' | 'bidded'>[]> {
  const seen = new Set<string>()
  const rawItems: RawItem[] = []

  for (const kw of config.keywords) {
    console.log(`Scanning: "${kw}"`)
    if (config.sources.includes('shopgoodwill')) {
      const items = await searchShopGoodwill(kw, config.max_search_price, config.pages_per_keyword)
      for (const item of items) {
        if (!seen.has(item.url)) { seen.add(item.url); rawItems.push(item) }
      }
    }
    if (config.sources.includes('ctbids')) {
      const items = await searchCTBids(kw, config.max_search_price, config.pages_per_keyword)
      for (const item of items) {
        if (!seen.has(item.url)) { seen.add(item.url); rawItems.push(item) }
      }
    }
    await jitter(2000, 5000)
  }

  console.log(`Found ${rawItems.length} unique items`)
  console.log(`  SG: ${rawItems.filter(i => i.source === 'ShopGoodwill').length} | CTBids: ${rawItems.filter(i => i.source === 'CTBids').length}`)
  if (rawItems.length > 0) {
    console.log(`  Sample: "${rawItems[0].title}" $${rawItems[0].current_bid} [${rawItems[0].source}]`)
  }
  const deals: Omit<Deal, 'id' | 'created_at' | 'updated_at' | 'notified' | 'dismissed' | 'bidded'>[] = []

  // Filter out obviously bad items first
  const candidates = rawItems.filter(item => item.title && item.current_bid > 0)

  // Batch value estimation — one Claude call per 30 items (fast + cheap with Haiku)
  const BATCH_SIZE = 30
  const valueMap = new Map<string, { value: number; source: string }>()
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const uncached = batch.filter(item => !valueCache.has(item.title))
    if (uncached.length > 0) {
      console.log(`Estimating values for batch of ${uncached.length} items...`)
      const results = await estimateValueBatch(uncached.map(item => item.title))
      uncached.forEach((item, idx) => {
        valueCache.set(item.title, results[idx] ?? { value: 0, source: '' })
      })
    }
    batch.forEach(item => {
      valueMap.set(item.url, valueCache.get(item.title) ?? { value: 0, source: '' })
    })
  }

  for (const item of candidates) {
    const { value: estVal, source: valSrc } = valueMap.get(item.url) ?? { value: 0, source: '' }
    if (estVal <= 0) continue
    if (estVal / item.current_bid < config.min_value_ratio * 0.65) continue

    let img: ImageAnalysis | null = null
    if (config.analyze_images && item.image_url) {
      img = await analyzeImage(item.image_url, item.title)
      if (img && img.is_authentic === false && !config.include_suspected_fakes) continue
    }

    const score = scoreDeal(item, estVal, img, config)
    if (score < config.min_deal_score) continue

    const adjVal = estVal * (img?.value_multiplier ?? 1)
    if (adjVal / item.current_bid < config.min_value_ratio) continue

    deals.push({
      title: item.title,
      current_bid: item.current_bid,
      estimated_value: estVal,
      adjusted_value: Math.round(adjVal * 100) / 100,
      deal_score: score,
      url: item.url,
      image_url: item.image_url,
      source: item.source,
      end_time: item.end_time,
      time_remaining: item.time_remaining,
      num_bids: item.num_bids,
      category: categorize(item.title),
      matched_keyword: item.matched_keyword,
      value_source: valSrc,
      condition: img?.condition ?? null,
      condition_score: img?.condition_score ?? null,
      completeness: img?.completeness ?? null,
      is_authentic: img?.is_authentic ?? null,
      value_multiplier: img?.value_multiplier ?? 1,
      flags: img?.flags ?? [],
      positives: img?.positives ?? [],
      img_summary: img?.summary ?? null,
    })

    console.log(`DEAL [${score}] $${item.current_bid} → $${adjVal.toFixed(2)}: ${item.title.slice(0, 50)}`)
  }

  return deals.sort((a, b) => b.deal_score - a.deal_score)
}
