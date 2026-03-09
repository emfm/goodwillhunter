export interface Deal {
  id: string
  title: string
  current_bid: number
  estimated_value: number
  adjusted_value: number
  deal_score: number
  url: string
  image_url: string
  source: 'ShopGoodwill' | 'CTBids'
  end_time: string
  time_remaining: string
  num_bids: number
  category: string
  matched_keyword: string
  value_source: string
  condition: string | null
  condition_score: number | null
  completeness: string | null
  is_authentic: boolean | null
  value_multiplier: number
  flags: string[]
  positives: string[]
  img_summary: string | null
  description: string | null
  match_type: 'text' | 'image'
  notified: boolean
  dismissed: boolean
  bidded: boolean
  starred: boolean          // pinned to top, always visible
  first_seen_at: string     // when first found — for NEW badge
  scan_id: string | null    // which scan found it
  created_at: string
  updated_at: string
}

export interface AppConfig {
  sources: string[]
  keywords: string[]
  high_value_keywords: string[]
  min_deal_score: number
  min_value_ratio: number
  max_search_price: number
  pages_per_keyword: number
  analyze_images: boolean
  include_suspected_fakes: boolean
  email_when_empty: boolean
  // Email
  alert_email: string
  alert_score_threshold: number
  // SMS
  alert_phone: string
  sms_enabled: boolean
  sms_score_threshold: number
}

export const DEFAULT_CONFIG: AppConfig = {
  sources: ['shopgoodwill', 'ctbids'],
  keywords: [
    'atari', 'big box pc game', 'ms-dos game', 'signed autograph',
    'nintendo 64', 'sega genesis', 'game boy', 'commodore 64',
    'pokemon cards', 'magic the gathering', 'vintage game', 'cib complete',
    'intellivision', 'colecovision', 'vectrex',
  ],
  high_value_keywords: [
    'sealed', 'mint', 'graded', 'psa', 'bgs', 'signed', 'autograph',
    'rare', 'limited edition', 'complete in box', 'big box', 'prototype',
  ],
  min_deal_score: 45,
  min_value_ratio: 1.5,
  max_search_price: 300,
  pages_per_keyword: 2,
  analyze_images: true,
  include_suspected_fakes: false,
  email_when_empty: false,
  alert_email: '',
  alert_score_threshold: 70,
  alert_phone: '',
  sms_enabled: false,
  sms_score_threshold: 75,
}
