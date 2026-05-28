# Auto Marketplace Tracker

Tracks Facebook Marketplace vehicle listings over time **and** lets you search for a
specific vehicle on demand: scrape → dedup → record price history → browse / search in
a local web UI, backed by a shared hosted Postgres.

## Pieces

- **`scrape.cjs`** — standalone **Playwright** scraper. Drives a real (headed) Chrome from
  the command line to read logged-out Marketplace pages and writes batches to
  `sweep_batches/`. No browser extension, fully scriptable.
- **`marketplace_tracker.cjs`** — ingests scrape batches into the shared **Postgres** DB,
  dedups by FB listing ID, tracks `first_seen`/`last_seen`/price history, exports an xlsx.
- **`scheduler.cjs`** — worker that re-runs *scheduled* searches on their interval.
- **`lib/`** — `pg.js` (pool + schema), `parse.js` (listing parser + van/junk classifiers),
  `db.js` (web read layer), `searchParse.js` (free-text → query + filters),
  `searchJobs.js` (live search jobs), `searchStore.js` (search history + scheduling),
  `grid.cjs` (shared metro grid).
- **`app/`** — Next.js UI: browse all (`/`), find a vehicle (`/search`), saved & scheduled
  searches (`/searches`); APIs `/api/listings`, `/api/search`, `/api/searches`.
- **`sweep_batches/`** — raw scrape output (gitignored).

> The database is **hosted Postgres (Neon)** so multiple machines share one dataset.
> Set `DATABASE_URL` in `.env.local` (copy `.env.example`). See `HANDOFF.md`.

## Data model

- **`listings`** — one row per unique listing (current state): price, `first_price`,
  `first_seen`, `last_seen`, `times_seen`, `is_active`, parsed year/make/model/…, `hash`.
- **`observations`** — append-only log; one row each time a listing is seen → price history.
- **`searches`** — saved searches: text, parsed query/filters, run stats, and scheduling
  (`scheduled`, `interval_minutes`, `next_run_at`).

## Usage

```bash
npm install                    # installs playwright-core; uses your system Chrome
cp .env.example .env.local     # paste the real Neon DATABASE_URL

# scrape cities (all-vehicles category) then ingest
node scrape.cjs atlanta charlotte nashville              # -> sweep_batches/<city>_vehicles.json
node marketplace_tracker.cjs ingest sweep_batches/atlanta_vehicles.json --export

# or a keyword search across cities
node scrape.cjs --query "camaro zl1" atlanta dallas miami

# web UI
npm run dev                    # http://localhost:3000

# scheduled-search worker (separate terminal, keep running)
node scheduler.cjs
```

## How scraping works

`scrape.cjs` opens a real logged-out Chrome (Playwright, `channel: 'chrome'`) and reads
either the `/marketplace/<city>/vehicles` category or `/marketplace/<city>/search?query=…`.
Logged-out caps each page at ~40 results, so coverage comes from sweeping a **grid of
cities** and unioning results (deduped by ID). No account, no credentials, no extension.

## Web app

- **`/`** — browse / filter / sort all tracked listings.
- **`/search`** — type free text like `camaro zl1 under 25,000 miles`; it scrapes the metro
  grid for the keywords, ingests, then shows matches filtered by the parsed limits.
- **`/searches`** — every previous search; mark any as scheduled and pick an interval
  (6h / 12h / daily / …). `scheduler.cjs` re-runs them automatically.

## Roadmap

- ✅ Standalone scraper + shared Postgres + web UI
- ✅ On-demand search + saved/scheduled searches
- ⬜ Deploy publicly (multi-user) + auth
- ⬜ Price-drop / new-match alerts (email/push)
- ⬜ Smarter ranking & scam/price-sanity filtering
- ⬜ (Later) migrate Neon → self-hosted Postgres (`pg_dump`/`pg_restore`)
