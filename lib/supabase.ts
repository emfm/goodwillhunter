import { createClient } from '@supabase/supabase-js'
import { AppConfig, DEFAULT_CONFIG } from './types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Client for browser (anon key, row-level security applies)
export const supabase = createClient(url, anon)

// Admin client for server-side API routes (bypasses RLS)
export const supabaseAdmin = () => createClient(url, service)

// ── Config helpers ────────────────────────────────────────────────────────────
export async function getConfig(): Promise<AppConfig> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('app_config')
    .select('value')
    .eq('key', 'main')
    .single()
  return data ? (data.value as AppConfig) : DEFAULT_CONFIG
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const db = supabaseAdmin()
  await db.from('app_config').upsert({
    key: 'main',
    value: config,
    updated_at: new Date().toISOString(),
  })
}

// ── Scan state helpers ────────────────────────────────────────────────────────
export async function getLastScanTime(): Promise<string | null> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('app_config')
    .select('value')
    .eq('key', 'last_scan')
    .single()
  return data ? (data.value as string) : null
}

export async function setLastScanTime(): Promise<void> {
  const db = supabaseAdmin()
  await db.from('app_config').upsert({
    key: 'last_scan',
    value: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
}
