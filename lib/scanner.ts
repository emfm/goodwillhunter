import { AppConfig, Deal } from './types'

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
async function searchShopGoodwill(keyword: string, maxPrice: number, pages: number): Promise<RawItem[]> {
  const results: RawItem[] = []
  for (let page = 1; page <= pages; page++) {
    try {
      const res = await fetch('https://buyerapi.shopgoodwill.com/api/Search/ItemListing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          'Origin': 'https://shopgoodwill.com',
          'Referer': 'https://shopgoodwill.com/',
        },
        body: JSON.stringify({
          searchText: keyword, categoryIds: '', selectedCategoryIds: '',
          closedAuctionDays: 0, startingPrice: 0, maxPrice,
          isBuyNow: false, isPickupOnly: false, isSearchDescriptions: true,
          favorites: false, sortColumn: 'ClosingDate', sortDescending: false,
          page, pageSize: 40, sellerId: 0, sellerName: '',
          catLevel: 0, catId: 0, locationId: 0,
        }),
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) break
      const data = await res.json()
      const items = data?.searchResults?.items ?? []
      if (!items.length) break
      for (const item of items) {
        const endTime = item.endTime ?? ''
        if (isExpired(endTime)) continue
        results.push({
          title: item.title ?? '',
          current_bid: parseFloat(item.currentPrice ?? 0),
          url: `https://shopgoodwill.com/item/${item.itemId}`,
          image_url: item.imageURL ?? '',
          end_time: endTime,
          time_remaining: timeRemaining(endTime),
          num_bids: parseInt(item.numberOfBids ?? 0),
          source: 'ShopGoodwill',
          matched_keyword: keyword,
        })
      }
      await sleep(1000)
    } catch (e) {
      console.warn(`ShopGoodwill error (${keyword}):`, e)
      break
    }
  }
  return results
}

// ── CTBids ────────────────────────────────────────────────────────────────────
async function searchCTBids(keyword: string, maxPrice: number, pages: number): Promise<RawItem[]> {
  const results: RawItem[] = []
  for (let page = 1; page <= pages; page++) {
    try {
      const params = new URLSearchParams({
        searchText: keyword, pageNumber: String(page),
        pageSize: '40', sortOrder: 'ClosingDateASC', isSearchDescription: 'true',
      })
      const res = await fetch(`https://www.ctbids.com/api/item/search?${params}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.ctbids.com/' },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) break
      const data = await res.json()
      const items = data?.items ?? data?.data ?? []
      if (!items.length) break
      for (const item of items) {
        const endTime = (item.closingDate ?? item.endDate ?? '').slice(0, 19)
        if (isExpired(endTime)) continue
        const bid = parseFloat(item.currentBid ?? item.currentPrice ?? 0)
        if (bid > maxPrice) continue
        results.push({
          title: item.title ?? item.name ?? '',
          current_bid: bid,
          url: `https://www.ctbids.com/#!/item/detail/${item.itemId ?? item.id}`,
          image_url: item.imageURL ?? item.thumbnailURL ?? '',
          end_time: endTime,
          time_remaining: timeRemaining(endTime),
          num_bids: parseInt(item.bidCount ?? 0),
          source: 'CTBids',
          matched_keyword: keyword,
        })
      }
      await sleep(1000)
    } catch (e) {
      console.warn(`CTBids error (${keyword}):`, e)
      break
    }
  }
  return results
}

// ── Value estimator ───────────────────────────────────────────────────────────
const valueCache = new Map<string, { value: number; source: string }>()

async function estimateValue(title: string): Promise<{ value: number; source: string }> {
  if (valueCache.has(title)) return valueCache.get(title)!

  // PriceCharting
  try {
    const res = await fetch(
      `https://www.pricecharting.com/api/products?q=${encodeURIComponent(title)}&status=price`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (res.ok) {
      const data = await res.json()
      const products = data?.products ?? []
      if (products.length) {
        const p = products[0]
        const val = Math.max(
          Number(p['cib-price'] ?? 0),
          Number(p['loose-price'] ?? 0),
          Number(p['graded-price'] ?? 0)
        ) / 100
        if (val > 0) {
          const result = { value: val, source: `PriceCharting (${p['product-name'] ?? ''})` }
          valueCache.set(title, result)
          return result
        }
      }
    }
  } catch {/* fallthrough */}

  // eBay sold listings
  try {
    const params = new URLSearchParams({
      _nkw: title, LH_Complete: '1', LH_Sold: '1', _sop: '13', _ipg: '25',
    })
    const res = await fetch(`https://www.ebay.com/sch/i.html?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const html = await res.text()
      const matches = [...html.matchAll(/\$([0-9,]+\.?\d*)/g)]
      const prices = matches
        .map(m => parseFloat(m[1].replace(/,/g, '')))
        .filter(p => p > 0.5 && p < 5000)
      if (prices.length >= 3) {
        prices.sort((a, b) => a - b)
        const q1 = Math.floor(prices.length / 4)
        const q3 = Math.floor((3 * prices.length) / 4)
        const mid = prices.slice(q1, q3 > q1 ? q3 : undefined)
        const median = mid.reduce((a, b) => a + b, 0) / mid.length
        const result = { value: Math.round(median * 100) / 100, source: `eBay sold (${prices.length} listings)` }
        valueCache.set(title, result)
        return result
      }
    }
  } catch {/* fallthrough */}

  const result = { value: 0, source: '' }
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
      headers: { 'User-Agent': 'Mozilla/5.0' },
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
    await sleep(600)
  }

  console.log(`Found ${rawItems.length} unique items`)
  const deals: Omit<Deal, 'id' | 'created_at' | 'updated_at' | 'notified' | 'dismissed' | 'bidded'>[] = []

  for (const item of rawItems) {
    if (!item.title || item.current_bid <= 0) continue

    const { value: estVal, source: valSrc } = await estimateValue(item.title)
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
