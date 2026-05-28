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
  `metroStore.js` (per-metro enable/disable), `grid.cjs` (the validated metro **catalog**,
  grouped by time-zone region).
- **`app/`** — Next.js UI: browse all (`/`), find a vehicle (`/search`), saved & scheduled
  searches (`/searches`), metro on/off (`/metros`); APIs `/api/listings`, `/api/search`,
  `/api/searches`, `/api/metros`.
- **`sweep_batches/`** — raw scrape output (gitignored).

> The database is **hosted Postgres (Neon)** so multiple machines share one dataset.
> Set `DATABASE_URL` in `.env.local` (copy `.env.example`). See `HANDOFF.md`.

## Data model

- **`listings`** — one row per unique listing (current state): price, `first_price`,
  `first_seen`, `last_seen`, `times_seen`, `is_active`, parsed year/make/model/…, `hash`.
- **`observations`** — append-only log; one row each time a listing is seen → price history.
- **`searches`** — saved searches: text, parsed query/filters, `region`, run stats, and
  scheduling (`scheduled`, `interval_minutes`, `next_run_at`).
- **`metros`** — the metro catalog (`slug`, `region`, `label`, `enabled`); seeded from
  `grid.cjs`. Searches/scheduled runs scrape only the **enabled** metros in the region.

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

Cities come from a validated **catalog of 66 metros** in `lib/grid.cjs`, grouped into four
time-zone regions (Eastern 24, Central 21, Mountain 10, Pacific 11). Every slug was
confirmed to resolve to the intended US city — FB only exposes name slugs for major metros,
so Mountain/Pacific are smaller (mid-size cities would need FB numeric location IDs). The
UI search picks a region; the `/metros` page enables/disables individual metros.

## Web app

- **`/`** — browse / filter / sort all tracked listings.
- **`/search`** — type free text like `camaro zl1 under 25,000 miles` and pick a **region**;
  it scrapes that region's enabled metros, ingests, then shows matches filtered by the parsed
  limits.
- **`/searches`** — every previous search; mark any as scheduled and pick an interval
  (6h / 12h / daily / …). The region is saved per search. `scheduler.cjs` re-runs them.
- **`/metros`** — turn individual metros on/off per region (persists to the `metros` table).

## Roadmap

- ✅ Standalone scraper + shared Postgres + web UI
- ✅ On-demand search + saved/scheduled searches
- ✅ Time-zone regions + per-metro on/off (66-metro catalog)
- ⬜ More Mountain/Pacific metros via FB numeric location IDs
- ⬜ Deploy publicly (multi-user) + auth
- ⬜ Price-drop / new-match alerts (email/push)
- ⬜ Smarter ranking & scam/price-sanity filtering
- ⬜ (Later) migrate Neon → self-hosted Postgres (`pg_dump`/`pg_restore`)
