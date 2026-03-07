-- Run this in: Supabase Dashboard > SQL Editor > New Query

-- ── Deals table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title           text NOT NULL,
  current_bid     decimal(10,2),
  estimated_value decimal(10,2),
  adjusted_value  decimal(10,2),
  deal_score      decimal(5,1),
  url             text UNIQUE NOT NULL,
  image_url       text,
  source          text,
  end_time        text,
  time_remaining  text,
  num_bids        integer DEFAULT 0,
  category        text,
  matched_keyword text,
  value_source    text,
  -- Image analysis
  condition       text,
  condition_score integer,
  completeness    text,
  is_authentic    boolean,
  value_multiplier decimal(4,2) DEFAULT 1.0,
  flags           jsonb DEFAULT '[]',
  positives       jsonb DEFAULT '[]',
  img_summary     text,
  -- User state
  notified        boolean DEFAULT false,
  dismissed       boolean DEFAULT false,
  bidded          boolean DEFAULT false,
  -- Timestamps
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ── Config table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deals_score    ON deals (deal_score DESC);
CREATE INDEX IF NOT EXISTS idx_deals_source   ON deals (source);
CREATE INDEX IF NOT EXISTS idx_deals_category ON deals (category);
CREATE INDEX IF NOT EXISTS idx_deals_dismissed ON deals (dismissed);
CREATE INDEX IF NOT EXISTS idx_deals_created  ON deals (created_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Allows public reads (the dashboard) — writes need service role key (API routes only)
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public reads deals" ON deals FOR SELECT USING (true);
CREATE POLICY "Public reads config" ON app_config FOR SELECT USING (true);

-- ── Auto-expire old deals (optional cleanup) ──────────────────────────────────
-- Uncomment to auto-delete deals older than 30 days:
-- CREATE OR REPLACE FUNCTION delete_old_deals() RETURNS void AS $$
--   DELETE FROM deals WHERE created_at < NOW() - INTERVAL '30 days';
-- $$ LANGUAGE SQL;
