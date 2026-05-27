# Sprinter Tracker

Tracks Facebook Marketplace van listings over time: scrape → dedup → record price history → browse in a local web UI.

## Pieces

- **`marketplace_tracker.cjs`** — ingests scrape batches into SQLite (`listings.db`), dedups by FB listing ID, tracks `first_seen` / `last_seen` / price history, and exports an xlsx.
- **`lib/` + `app/`** — a Next.js web UI to view, sort, and filter the tracked listings.
- **`sweep_batches/`** — raw scrape output (gitignored).

## Data model

- **`listings`** — one row per unique listing (current state): current price, `first_price`, `first_seen`, `last_seen`, `times_seen`, `is_active`, content `hash`.
- **`observations`** — append-only log; one row each time a listing is seen, giving full price history.

## Usage

```bash
npm install

# ingest a scrape batch (and export xlsx)
npm run ingest -- sweep_merged.json --export

# run the web UI
npm run dev          # http://localhost:3000
```

## How scraping works

Listings are scraped from logged-out Marketplace search pages (`/marketplace/<city>/search?query=…`), which are public but cap each search at ~40 results. Coverage comes from sweeping a **grid of cities × van queries** and unioning the results (deduped by ID). No account, no credentials.

## Roadmap

- Finish the multi-city sweep automation
- Migrate SQLite → hosted Postgres for a multi-user deployed app
- Scheduled re-scrapes + price-drop alerts
