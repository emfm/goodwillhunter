# 🎯 Goodwill Hunter — Deploy Guide

You'll have a live website in about 20 minutes. No AWS. No servers. Free.

---

## What You're Setting Up

| Service | What it does | Cost |
|---------|-------------|------|
| **Vercel** | Hosts the website + runs the scanner | Free |
| **Supabase** | Database (stores deals) | Free |
| **Resend** | Sends alert emails | Free (3000/mo) |
| **Anthropic** | AI image analysis | ~$1–2/month |

---

## Step 1 — Supabase (Database)

**Time: ~5 min**

1. Go to **supabase.com** → Sign up (free, use GitHub login)
2. Click **New Project** → name it `goodwill-hunter` → pick any region → create
3. Wait ~2 min for it to provision
4. Go to **SQL Editor** (left sidebar) → **New Query**
5. Copy the entire contents of `schema.sql` → paste → click **Run**
6. You should see "Success" — your tables are created

**Get your keys:**
- Go to **Settings** (gear icon) → **API**
- Copy all three values — you'll need them shortly:
  - `Project URL` (looks like `https://xxxx.supabase.co`)
  - `anon` public key (starts with `eyJ...`)
  - `service_role` key (starts with `eyJ...`, keep this private)

---

## Step 2 — Resend (Email)

**Time: ~3 min**

1. Go to **resend.com** → Sign up free
2. Go to **API Keys** → **Create API Key** → name it `goodwill-hunter` → Create
3. Copy the key (starts with `re_...`) — you only see it once
4. **To send from your own domain:** go to Domains → Add Domain → follow the DNS steps
   OR on free tier, emails send from `onboarding@resend.dev` to your verified email

---

## Step 3 — Anthropic (Image Analysis)

**Time: ~2 min**

1. Go to **console.anthropic.com** → sign up / log in
2. Click **API Keys** → **Create Key** → name it `goodwill-hunter`
3. Copy the key (starts with `sk-ant-...`)
4. Go to **Billing** → add $5 in credits (lasts months at typical usage)

---

## Step 4 — Deploy to Vercel

**Time: ~5 min**

### 4a. Put the code on GitHub

1. Go to **github.com** → click **+** → **New repository**
2. Name: `goodwill-hunter` · Set to **Private** · Click Create
3. Upload all files from this folder to the repo (drag and drop, or use GitHub Desktop)

### 4b. Connect to Vercel

1. Go to **vercel.com** → Log in with GitHub (or sign up)
2. Click **Add New Project** → find `goodwill-hunter` → click **Import**
3. Leave all settings as default → click **Deploy**
4. It will fail on first deploy — that's fine, we need to add env vars first

### 4c. Add Environment Variables

In your Vercel project → **Settings** → **Environment Variables**

Add each of these (click Add for each):

| Name | Value | Where to get it |
|------|-------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (anon key) | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (service_role key) | Supabase → Settings → API |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | console.anthropic.com |
| `RESEND_API_KEY` | `re_...` | resend.com → API Keys |
| `RESEND_FROM` | `Goodwill Hunter <onboarding@resend.dev>` | Use this until you add a domain |
| `ALERT_EMAIL` | `your@email.com` | Your email address |
| `CRON_SECRET` | `any-long-random-string-you-make-up` | Make up anything e.g. `hunter2025xkcd` |

After adding all variables → click **Redeploy** (Deployments tab → click the three dots → Redeploy)

### 4d. Verify it works

Your site will be live at `https://goodwill-hunter-xxxx.vercel.app`

- Open it — you should see the empty dashboard
- Click **⚙ Config** — set your email, adjust keywords
- Click **⚡ Run Scan** — enter your CRON_SECRET when prompted
- Wait 2–5 minutes — deals will appear!

---

## Step 5 — Automatic Scheduling

The `vercel.json` file sets the scanner to run **every 6 hours** automatically.

**⚠ Important:** Vercel Hobby (free) plan only supports **1 cron job per day**.

**Option A — Upgrade to Vercel Pro ($20/month):**
Gets you hourly cron jobs and longer function timeouts. Worth it if you use this heavily.

**Option B — Use cron-job.org (free):**
1. Go to **cron-job.org** → sign up free
2. Click **Create cronjob**
3. URL: `https://your-site.vercel.app/api/scan`
4. Set schedule: every 4 or 6 hours
5. Under "Headers" → add: `Authorization: Bearer your-CRON_SECRET`
6. Save — it'll call your scanner automatically

---

## Using the Dashboard

### Finding deals
- Deals are shown in a grid, sorted by score (highest first)
- Use filters at the top to narrow by source, category, or minimum score
- 🔥 Score 70+ = great deal · 👍 50-69 = worth checking

### AI Image Analysis
- Click the **🤖 AI Image Analysis** toggle on any card to see:
  - Condition (Sealed/Mint/Good/Fair/Poor)
  - Completeness (CIB, cart only, etc.)
  - Red flags and positives spotted in the image
  - Value adjustment applied

### Bidding
- Click **🎯 Bid Now** → opens the auction in a new tab and marks the deal
- The deal shows "✓ Bid placed" so you remember what you've acted on

### Managing deals
- Click **✕** on any card to dismiss it (hide from view)
- Toggle "Show dismissed" in the filter bar to see dismissed deals
- Deals stay in the database — nothing is ever deleted automatically

### Email alerts
- Configure your alert email and score threshold in **⚙ Config → Alerts**
- You'll get an email when the scanner finds deals above your threshold
- The email has the same images, scores, and AI analysis as the website

---

## Updating Keywords

Go to your site → **⚙ Config** → **Keywords tab** → add/remove → **Save Changes**

Changes take effect on the next scan run.

---

## Troubleshooting

**White screen / error on load**
→ Check Vercel deployment logs (Vercel dashboard → your project → Deployments → click the failed one → View logs)
→ Usually means an env var is missing or wrong

**"No deals found" every run**
→ Lower min_deal_score to 35 in Config → Scoring
→ Lower min_value_ratio to 1.2
→ Add more keywords
→ Check Vercel function logs for errors (Functions tab in Vercel dashboard)

**Email not arriving**
→ Check spam folder
→ Verify RESEND_API_KEY is correct
→ Make sure alert_email is set in Config → Alerts
→ Try resend.com → Logs to see if emails were attempted

**Scan times out (function timeout)**
→ On Vercel Hobby, function timeout is 10s — the scan needs longer
→ Use Option B above (cron-job.org) which works differently
→ Or upgrade to Vercel Pro for 60–300s function timeouts

---

## File Reference

```
goodwill-hunter-app/
├── app/
│   ├── page.tsx           ← Main dashboard
│   ├── config/page.tsx    ← Settings UI
│   └── api/
│       ├── scan/          ← Scanner endpoint (runs every 6h)
│       ├── deals/         ← Read/update deals
│       └── config/        ← Read/write settings
├── lib/
│   ├── scanner.ts         ← All scraping + AI analysis logic
│   ├── email.ts           ← Resend alert emails
│   ├── supabase.ts        ← Database connection
│   └── types.ts           ← TypeScript types
├── schema.sql             ← Run once in Supabase SQL Editor
├── vercel.json            ← Cron schedule config
└── .env.example           ← Template for your secrets
```
