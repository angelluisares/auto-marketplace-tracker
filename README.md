# Auto Marketplace Tracker

Tracks Facebook Marketplace vehicle listings over time: scrape → dedup → record price history → browse in a local web UI.

## Pieces

- **`marketplace_tracker.cjs`** — ingests scrape batches into a shared hosted **Postgres** DB, dedups by FB listing ID, tracks `first_seen` / `last_seen` / price history, and exports an xlsx.
- **`lib/pg.js`** — shared Postgres pool + schema. **`lib/parse.js`** — parsers + van/junk classifiers. **`lib/db.js`** — web read layer.
- **`app/`** — a Next.js web UI to view, sort, and filter the tracked listings.
- **`sweep_batches/`** — raw scrape output (gitignored).

> The database is **hosted Postgres (Neon)** so multiple machines can scrape into one shared dataset. Set `DATABASE_URL` in `.env.local` (copy from `.env.example`). See `HANDOFF.md` for full setup.

## Data model

- **`listings`** — one row per unique listing (current state): current price, `first_price`, `first_seen`, `last_seen`, `times_seen`, `is_active`, content `hash`.
- **`observations`** — append-only log; one row each time a listing is seen, giving full price history.

## Usage

```bash
npm install
cp .env.example .env.local     # then paste the real Neon DATABASE_URL

# ingest a scrape batch (and export xlsx) — UPSERTs into the shared Postgres
npm run ingest -- sweep_merged.json --export

# run the web UI
npm run dev          # http://localhost:3000
```

## How scraping works

Listings are scraped from logged-out Marketplace search pages (`/marketplace/<city>/search?query=…`), which are public but cap each search at ~40 results. Coverage comes from sweeping a **grid of cities × van queries** and unioning the results (deduped by ID). No account, no credentials.

## Roadmap

- Finish the multi-city sweep + broaden beyond vans
- Deploy the Next.js app publicly (multi-user) + auth
- Scheduled re-scrapes + price-drop alerts
- (Later) migrate Neon → self-hosted Postgres (plain `pg_dump`/`pg_restore`)
