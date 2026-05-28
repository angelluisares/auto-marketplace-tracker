# Project Handoff — Auto Marketplace Tracker

This document hands the project off to a **Claude Code / developer session on another
machine**. Read it fully before doing any work. It covers the goal, the architecture, how
to **connect to the shared hosted database**, the **scraping method** (now a standalone
script), the **on-demand search + scheduling** feature, the current state, and where to
pick up.

---

## 0. QUICK START (do this first on a new machine)

```bash
git clone https://github.com/angelluisares/auto-marketplace-tracker.git
cd auto-marketplace-tracker
npm install                       # installs deps incl. playwright-core

# Connect to the SHARED hosted database (see §2):
cp .env.example .env.local
#   then edit .env.local and paste the real Neon DATABASE_URL
#   (get it from Angel / the Neon dashboard — it is NOT in the repo)

# Verify you can reach the shared DB:
node -e "require('dotenv').config({path:'.env.local'});const{Pool}=require('pg');new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}).query('SELECT count(*) FROM listings').then(r=>{console.log('listings in shared DB:',r.rows[0].count);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"

# Web UI:
npm run dev                       # http://localhost:3000

# Scheduled-search worker (separate terminal, keep running):
node scheduler.cjs
```

**Requirements:** Node 18+ (developed on Node 24) and **Google Chrome installed** — the
scraper uses Playwright with `channel: 'chrome'`, i.e. your real Chrome, not a downloaded
Chromium. If the verify command prints a count (1,000+), you're on the shared DB.

---

## 1. What we are building

A tool that **tracks used-vehicle listings from Facebook Marketplace over time** and lets a
user **search for a specific vehicle on demand**. Scope is **ALL vehicles** (renamed from
`sprinter-tracker`; van/junk classifiers are now optional filters, not the focus).

**End goal:** a multi-user web app on a public URL. Stages:
1. ✅ Scrape pipeline → DB
2. ✅ Local web front end (Next.js)
3. ✅ Shared hosted Postgres (Neon) — multiple machines write one dataset
4. ✅ **Standalone Playwright scraper** (no browser extension; scriptable & schedulable)
5. ✅ **On-demand search UI** (free-text → scrape → filtered matches)
6. ✅ **Saved & scheduled searches** (re-run on an interval via a worker)
7. ⬜ Deploy publicly (multi-user) + auth
8. ⬜ Price-drop / new-match alerts
9. ⬜ (Later) migrate Neon → self-hosted Postgres

---

## 2. The shared database (Neon Postgres)

**The database is hosted Postgres on Neon, NOT a local SQLite file.** Both machines and the
web app connect to the same DB over the network.

- The connection string lives ONLY in **`.env.local`** (gitignored). It is **NOT in the
  repo** (the repo is public). Get the real `DATABASE_URL` from Angel or the Neon dashboard.
- `lib/pg.js` is the shared pool + schema (standard Postgres, SSL required), portable via
  `pg_dump` to any server later (§9).
- **SECURITY:** never commit `.env.local` or paste the connection string into a tracked
  file. If a credential leaks, rotate the Neon role password.

### Tables
- **`listings`** — one row per unique listing (current state), keyed by FB `id`: `price_num`,
  `first_price` (never overwritten), `first_seen`, `last_seen`, `times_seen`, `is_active`,
  content `hash`, parsed `year/make/model/trim/roof/wheelbase/drivetrain/mileage_num/
  city/state`, `raw_text`.
- **`observations`** — append-only; one row every time a listing is seen → price history.
- **`searches`** — saved searches (added this session). Columns: `text` (unique, the raw
  query string), parsed `query/max_miles/max_price/min_year/max_year`, `run_count`,
  `last_run_at`, `last_found`, and scheduling `scheduled`/`interval_minutes`/`next_run_at`.
  Created lazily by `lib/searchStore.js`.

---

## 3. SCRAPING — now a standalone script (read carefully)

**Principle (unchanged): logged-out Marketplace + a GRID of city slugs. No login.**
- Logged-out search/category/listing pages are public (a login modal pops up but is
  dismissable — it's not an auth wall).
- Logged-out caps each page at **~40 results** and has no radius control, so coverage comes
  from sweeping **many cities** and unioning results (dedup by FB listing ID). No account.

**What changed: scraping is now `scrape.cjs` (Node + Playwright), NOT Claude hand-driving a
browser extension.** This is the durable method and the one to use going forward.

```bash
# all-vehicles category, one or more cities -> sweep_batches/<city>_vehicles.json
node scrape.cjs atlanta charlotte nashville

# keyword search across cities -> sweep_batches/<city>_<query_with_underscores>.json
node scrape.cjs --query "camaro zl1" atlanta dallas miami
```

How `scrape.cjs` works:
- `chromium.launchPersistentContext(.pw-profile, { channel: 'chrome', headless: false })` —
  a real, headed Chrome with a persistent profile (`.pw-profile/`, gitignored). Headed +
  real Chrome + persistent profile is what gets past FB's logged-out anti-bot checks.
- For each city: navigate, dismiss the login modal, scroll to the bottom until the card
  count stabilizes (~40 cap), then read every `a[href*="/marketplace/item/"]` → `{id, text}`.
- Writes the batch JSON straight to `sweep_batches/`. Then ingest with
  `node marketplace_tracker.cjs ingest <file>` (UPSERTs into the shared Postgres).

### Why we abandoned the old "Claude drives Chrome via the extension" method
It worked but **does not scale and cannot be scheduled**:
- The Claude-in-Chrome extension forces a **manual approval prompt on every navigate/script**
  — dozens of clicks per sweep.
- Chrome's **"multiple automatic downloads" block** silently killed the page→disk transfer
  after the first file.
- A human-driven browser **can't run on a schedule**, which the roadmap requires.

`scrape.cjs` removes all three problems (one command, data straight to disk, schedulable).

### Gotchas / known issues
- **Ambiguous city slugs.** Bare `birmingham` resolves to **Birmingham, UK** — not Alabama.
  Always sanity-check the page `<title>` ("Cars, Trucks & Motorcycles For Sale in <City,
  ST>"); `scrape.cjs` logs it. Use unambiguous slugs or FB numeric location IDs for
  ambiguous names. (Birmingham AL is still TODO for this reason.)
- **FB search is loose.** `/search?query=…` returns the matches *plus* padding (other
  vehicles) up to ~40. That's fine: we ingest everything and filter precisely in the DB.
- The verified-good metro grid lives in **`lib/grid.cjs`** (shared by the live search and the
  scheduler): atlanta, charlotte, nashville, raleigh, charleston, greenville, knoxville,
  augusta, dallas, houston, miami, orlando.

---

## 4. On-demand search + scheduling (built this session)

The headline feature: a user types free text and gets matches, and can save/schedule it.

### Flow
1. **Parse** (`lib/searchParse.js`): free text → `{ query, maxMiles, maxPrice, minYear,
   maxYear }`. Keywords become the FB query; "under 25,000 miles" / "under $70k" / "2018+"
   become filters applied to our own parsed data (`mileage_num`/`price_num`/`year`) — we do
   NOT drive Facebook's filter UI (fragile). Example: `camaro zl1 under 25,000 miles` →
   query `camaro zl1`, maxMiles 25000.
2. **Job** (`lib/searchJobs.js`): spawns `scrape.cjs --query <q>` across the grid (tracking
   progress), ingests each batch, then queries the DB for matches (drops parts/junk under
   $800, sorts by mileage). In-memory jobs; status `scraping → ingesting → searching → done`.
3. **Persist** (`lib/searchStore.js`): every completed run is upserted into `searches`
   (run count, last found, etc.) and exposes list/schedule/results/due helpers.

### APIs
- `POST /api/search {text}` → start a job; `GET /api/search?id=` → poll status + results.
- `GET /api/searches` → list saved searches; `GET /api/searches?results=ID` → current matches
  (instant, no scrape); `PATCH /api/searches {id, scheduled, intervalMinutes}`;
  `DELETE /api/searches?id=`.

### Pages
- **`/search`** — single free-text box, shows how it parsed your text, a live progress bar
  while scraping the grid, then the results table. Auto-runs when opened as `/search?q=…`.
- **`/searches`** — every previous search; a per-row dropdown sets the schedule
  (Not scheduled / 6h / 12h / Daily / 3 days / Weekly), shows next-run, View (inline current
  matches), Run now, Delete.

### Scheduler worker — `scheduler.cjs`
- Run it in its own terminal: `node scheduler.cjs`. Every 60s it finds scheduled searches
  whose `next_run_at` is due, re-scrapes the grid, ingests, recomputes matches, and
  reschedules (via `recordRun`, which stamps the next run from the interval).
- **Scheduled searches only fire while `scheduler.cjs` is running** — it's a separate
  long-lived process from `npm run dev`. (Future: deploy it as a real cron/worker.)

---

## 5. Architecture & files

```
auto-marketplace-tracker/
├── scrape.cjs                # standalone Playwright scraper (headed real Chrome)
├── marketplace_tracker.cjs   # ingest scrape batches -> Postgres (dedup, history); xlsx export
├── scheduler.cjs             # worker: runs due scheduled searches every 60s
├── migrate_sqlite_to_pg.cjs  # one-time SQLite -> Postgres backfill (already run)
├── lib/
│   ├── pg.js                 # shared Postgres pool + schema (CJS)
│   ├── parse.js              # listing text parser + isVan/isJunk (ESM)
│   ├── db.js                 # web read layer: queryListings / facets / priceHistory (ESM)
│   ├── grid.cjs              # shared metro grid (CJS)
│   ├── searchParse.js        # free-text -> {query, maxMiles, maxPrice, year} (CJS)
│   ├── searchJobs.js         # live search jobs: scrape -> ingest -> match (ESM)
│   └── searchStore.js        # `searches` table: history + scheduling (CJS)
├── app/
│   ├── page.js               # browse all listings
│   ├── search/page.js        # on-demand search box
│   ├── searches/page.js      # saved & scheduled searches
│   ├── layout.js
│   └── api/
│       ├── listings/route.js # GET /api/listings
│       ├── search/route.js   # POST/GET /api/search (live job)
│       └── searches/route.js # GET/PATCH/DELETE /api/searches (history + scheduling)
├── next.config.mjs           # serverExternalPackages: ['pg','better-sqlite3']
├── .env.example              # template; copy to .env.local with real DATABASE_URL
├── README.md / HANDOFF.md
├── sweep_batches/            # raw scrape output (gitignored)
└── .pw-profile/              # scraper's Chrome profile (gitignored)
```

Module style note: files consumed by Next (`app/`, `lib/*.js`) use ESM; CJS helpers
(`*.cjs`, `lib/searchStore.js`) are required by both the scheduler (CJS) and the Next API
(ESM, via default import) — mirror the existing `import pg from './pg.js'` pattern.

### Ingest behavior (unchanged, keep it)
- **Dedup by `id`** (UPSERT). **Change detection** via content `hash`; **price drops** when
  current < previous. **`first_price` never updated** after insert.
- **Staleness-based deactivation:** mark `is_active=FALSE` only when `last_seen` is older than
  `staleDays` (default 7). A PARTIAL sweep must NOT deactivate everything absent.

---

## 6. Current state — where to pick up

- ✅ Shared Neon Postgres is the source of truth; **1,000+ listings** (grew from 286 → 533 via
  an all-vehicles sweep of 9 metros, then ~1,024 after broad keyword searches).
- ✅ Standalone `scrape.cjs` is the working scraper. Validated across many metros.
- ✅ On-demand search (`/search`), saved/scheduled searches (`/searches`), and `scheduler.cjs`
  are built and tested (parse, scrape→ingest→match, schedule persist, due-detection).
- ⚠️ Fresh clone has **code but no local data** — data lives in the shared Postgres (reach it
  via `.env.local`). `listings.db`, `sweep_batches/`, `*.xlsx`, `.pw-profile/`, `.env*` are
  gitignored.

### Next steps
1. **Birmingham, AL** — find the correct FB location (bare slug → UK) and add it to the grid.
2. **Smarter result filtering** — the $800 floor still lets obvious scam/bait listings through
   (e.g. a "$1,000" ZL1). Flag prices far below the median for a given search.
3. **Alerts** — on a scheduled run, diff new matches / price drops and notify (email/push).
4. **Deploy** the Next app + run `scheduler.cjs` as a hosted worker; add auth (multi-user).

---

## 7. Migrating Neon → self-hosted Postgres (later)

Schema is standard Postgres, so it's a plain dump/restore; only `DATABASE_URL` changes:
```bash
pg_dump "<neon DATABASE_URL>" -Fc -f backup.dump
pg_restore -d "<other server DATABASE_URL>" backup.dump
# then update DATABASE_URL in each machine's .env.local
```

---

## 8. Don't break these
- **Logged-out + city grid** is the scraping approach (no login). Scrape via `scrape.cjs`.
- **Staleness-based deactivation** (don't deactivate on single-batch absence).
- **`first_price` never overwritten** after insert.
- **`.env*`, `node_modules/`, `sweep_batches/`, `*.xlsx`, `*.db`, `.pw-profile/` are
  gitignored** — never commit data or secrets (repo is public).
- Filters are applied to **our parsed data**, not Facebook's filter UI.
- Sanity-check city slugs against the page title (Birmingham→UK trap).
