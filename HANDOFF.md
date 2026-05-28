# Project Handoff — Auto Marketplace Tracker

This document is written to hand the project off to a **Claude Code session on another machine**. Read it fully before doing any work. It explains the goal, the architecture, the **preferred scraping method** (this is the most important part), the current state, and the next steps.

---

## 1. What we are trying to build

A tool that **tracks used-vehicle listings from Facebook Marketplace over time** so the user can browse, sort, and filter them — and see how listings change (price drops, how long they've been listed, when they disappear).

Originally this was scoped to Mercedes Sprinter vans, but **the scope is now ALL vehicles** (that's why the project was renamed from `sprinter-tracker` to `auto-marketplace-tracker`). The van/junk classifiers still exist but are now optional filters, not the focus.

### End goal
A **multi-user web app on a public URL** where people can view/filter/organize the tracked listings. We are building toward that in stages:

1. ✅ Scrape pipeline → local SQLite + xlsx export
2. ✅ Local web front end (Next.js) reading the SQLite DB
3. ⬜ Finish full scrape coverage
4. ⬜ Migrate SQLite → hosted Postgres + deploy the web app (multi-user)
5. ⬜ Scheduled re-scrapes a few times/day + price-drop alerts

SQLite → Postgres is a clean migration (same schema, minor SQL dialect tweaks), so nothing built on SQLite is wasted.

---

## 2. THE PREFERRED SCRAPING METHOD (read this carefully)

**Use the LOGGED-OUT Marketplace, and get geographic coverage by SUBSTITUTING CITY SLUGS in the URL. This is the preferred method. Do not log in.**

### Why logged-out + city substitution is preferred
- **No account, no credentials, no login.** Avoids the account-flagging/ban risk that comes with heavy automated scraping on a logged-in Facebook account. This makes the tool sustainable and safe to run repeatedly, and appropriate for a public/shared app.
- Marketplace **search pages and individual listing pages are publicly viewable without an account.** A login modal pops up but is dismissable (it is NOT an auth wall — the listing data is in the page behind it).

### How it works
The URL pattern is:
```
https://www.facebook.com/marketplace/<CITY_SLUG>/search?query=<QUERY>
```
- `<CITY_SLUG>` controls location, e.g. `greenville`, `charlotte`, `atlanta`, `knoxville`, `nashville`, `augusta`, `raleigh`, `charleston`, `birmingham`, `huntsville`.
- `<QUERY>` is the search term, e.g. `mercedes sprinter`, `cargo van`, etc.

### The key constraints and the strategy that beats them
- **Logged-out caps each search at ~40 results** (no infinite scroll — the feed stops). You CANNOT get hundreds from one search logged-out.
- **Logged-out cannot set a radius** (defaults to ~40 mi around the city) and **cannot use the account's saved location**.
- **THE STRATEGY:** run **many small searches across a GRID of city slugs × queries**, then **union all results and dedup by listing ID**. ~10 cities × 2–3 queries × ~40 each → a few hundred **unique** listings covering a wide region. Adjacent cities overlap (~15–20%), which is fine — dedup handles it, and re-seeing a listing just confirms it's still live.

### What logged-IN gives you (and why we still don't use it)
Logged-in allows one big 500-mi-radius scrape (~600 results in a single pass) with infinite scroll. It's fewer requests per run, BUT it requires a Facebook account and carries flagging risk. **We deliberately chose logged-out** for safety/sustainability. Only revisit logged-in if logged-out coverage proves insufficient.

### Bonus: listed date
Individual listing **detail pages** (logged-out) expose a relative **"Listed X ago"** string (e.g. "Listed 5 weeks ago"). The pipeline can resolve that to an approximate date (`listed_date`). It's optional enrichment (extra page visits); when absent, our own `first_seen` timestamp is the backup.

---

## 3. How the scrape is actually executed (mechanics + gotchas)

Scraping is driven by **Claude operating a Chrome browser** via the Claude-in-Chrome extension tools. It is NOT a standalone headless script — Facebook blocks headless/scripted access, so it must run through a real browser Claude drives.

### Per-search procedure
1. `navigate` the controlled tab to the city/query search URL.
2. Run a JS snippet that: dismisses the login modal (find `[role="dialog"]` → click the close button by `aria-label`), then **scrolls to the bottom repeatedly** (`window.scrollTo(0, document.documentElement.scrollHeight)` with ~1.5s waits) until the count stops growing (the ~40 cap).
3. Collect each card: from every `a[href*="/marketplace/item/"]`, extract the listing **ID** from the URL and the card's `innerText` (price, year/make/model/trim, city/state, mileage).
4. Output `{ source, records: [{id, text}] }`.

### CRITICAL GOTCHA — getting data from the browser to disk
Several transfer channels are blocked by browser security; here is what works:
- ❌ **Downloads with the Save-As prompt ON** → blocks on a dialog. (User can disable: Chrome Settings → Downloads → turn OFF "Ask where to save each file before downloading.")
- ❌ **Page → localhost POST** → blocked by Chrome Private Network Access.
- ❌ **Large eval return values** → the tool result view truncates ~1KB, so you can't capture big payloads directly.
- ✅ **THE METHOD THAT WORKS:** trigger a Blob download from the page (use a **`.txt`** download name, type `text/plain`). Chrome writes the FULL data to a randomly-named **`.tmp`** file in the Downloads folder (it holds it as `.tmp` pending a "keep" rename, but **the complete content is already on disk**). Immediately read the newest `*.tmp` in `~/Downloads`, then `mv` it into `sweep_batches/<city>_<query>.json`.

  Practically: after each search's download, run something like
  `cd ~/Downloads && newest=$(ls -t *.tmp | head -1); mv "$newest" "<project>/sweep_batches/<city>_<query>.json"`

- The extension occasionally disconnects mid-call or the CDP screenshot/click pipeline hangs (~300s timeout). The **JavaScript eval channel and `navigate` are the most reliable**; prefer them over coordinate-based clicks/screenshots. Retry on transient disconnects.

---

## 4. Architecture & files

```
auto-marketplace-tracker/
├── marketplace_tracker.cjs   # CORE: ingest scrape batches → SQLite, dedup, price history, xlsx export
├── lib/db.js                 # read-only SQLite query layer for the web app (filters/sort/facets)
├── app/
│   ├── page.js               # the front-end UI (client component: sortable/filterable table)
│   ├── layout.js
│   └── api/listings/route.js # JSON API the UI calls (GET /api/listings?…)
├── next.config.mjs           # marks better-sqlite3 as a server-external package
├── package.json
├── README.md
├── HANDOFF.md                # this file
├── sweep_batches/            # raw scrape output (GITIGNORED)
└── listings.db               # SQLite DB (GITIGNORED — it's data, regenerated by scraping)
```

### Data model (SQLite, `listings.db`)
- **`listings`** — one row per UNIQUE listing (current state). Keyed by FB listing `id`. Columns include: `price_num`, `first_price` (price first time seen), `first_seen`, `last_seen`, `times_seen`, `is_active`, content `hash` (for change detection), `listed_date` (from FB, when available), plus parsed `year/make/model/trim/roof/wheelbase/drivetrain/mileage_num/city/state` and `raw_text`.
- **`observations`** — append-only log; one row EVERY time a listing is seen (`id`, `seen_at`, `price_num`, `hash`, `raw_text`). This is what gives full **price history** over time. `listings` only holds the current state; `observations` remembers everything.

### Ingest behavior (already implemented & tested)
- **Dedup by `id`**: new listings inserted with `first_seen`; existing ones update `last_seen`, bump `times_seen`.
- **Change detection** via content `hash`; **price drops** detected when current `price_num` < previous.
- **Deactivation is staleness-based, NOT single-batch-based.** Because each sweep is PARTIAL (van queries, subset of cities), a listing missing from one batch must NOT be marked gone. Listings are marked `is_active=0` only when `last_seen` is older than `staleDays` (default 7). **Keep this behavior** — do not revert to "deactivate everything not in this batch."

### CLI
```bash
node marketplace_tracker.cjs ingest <batch-or-merged.json> [--export]
node marketplace_tracker.cjs export       # regenerate xlsx from listings.db
```
Batch record shape: `[{ "id": "...", "text": "$45,000 | 2024 Mercedes-Benz sprinter ... | City, ST | 24K miles", "listed_rel": "Listed 3 weeks ago" (optional) }]`

To ingest the whole `sweep_batches/` folder, merge files first (union + dedup by id) into one JSON array, then `ingest` it. (There was a `sweep_merged.json` produced this way.)

---

## 5. Web front end

- **Next.js (App Router) + React.** `lib/db.js` opens `listings.db` **read-only** (WAL mode lets it read while the scraper writes). `app/api/listings/route.js` exposes `GET /api/listings` with query params: `q, make, state, vansOnly, hideJunk, activeOnly, minPrice, maxPrice, maxMileage, sort, dir`. `app/page.js` renders a sortable, filterable table with make/state facets.
- Defaults: **all vehicles** (Vans-only is an optional toggle, OFF by default), **Hide junk** ON.
- Run it:
  ```bash
  npm install
  npm run dev      # http://localhost:3000
  ```
- **Lock gotchas:** SQLite allows one writer; if DBeaver or another tool holds `listings.db`, an ingest may fail with "database is locked" — disconnect during ingests. The xlsx export auto-falls back to a timestamped filename if the primary `.xlsx` is open in Excel/OneDrive.

---

## 6. Current state (as of this handoff)

- Pipeline (ingest/dedup/history/price-drop/xlsx) **built and validated** with synthetic two-run tests.
- **9 of ~20 planned searches done** (in `sweep_batches/`): greenville ×2, charlotte ×2, atlanta ×2, knoxville ×2, nashville ×1. → **286 unique listings** in `listings.db` (349 raw, 63 dupes removed).
- Web UI built, running, rebranded to "Auto Marketplace Tracker," defaulting to all vehicles.
- Git repo initialized; pushed to GitHub: **`angelluisares/auto-marketplace-tracker`** (private).

### Data quality notes
- Parsing of price/year/make/model/trim/location is clean for vans. The `cargo van` query pulls in older Ford Econoline/E-series/Chevy Express (legitimately vans) plus some noise.
- **Junk** (rentals priced "$X/day", "parts out", accessories like "bench seat", $1–$50 scams, absurd prices) is **flagged, not deleted** — the user wanted everything kept with a flag. The UI's "Hide junk" toggle filters them out of view.

---

## 7. Next steps (in priority order)

1. **Finish the sweep** — run the remaining ~11 city/query searches (nashville/cargo van, plus augusta, raleigh, charleston, birmingham, huntsville × their queries) to reach ~500–600 unique. Use the logged-out + city-substitution method above. Merge → `ingest --export`.
2. **Broaden queries beyond vans** — since scope is now all vehicles, add queries/categories the user cares about (or scrape `/marketplace/<city>/vehicles` category pages, not just `search?query=`).
3. **Repeat the sweep over multiple days** to start accumulating real `observations` history (price drops, days-listed). Eventually schedule it a few times/day.
4. **Migrate to hosted Postgres + deploy** the Next.js app for multi-user access (the stated end goal). Add basic auth.

---

## 8. Things to preserve / not break

- **Logged-out + city substitution is the chosen method.** Don't switch to logged-in scraping without a deliberate reason.
- **Staleness-based deactivation** (don't deactivate on single-batch absence).
- **`first_price` is never overwritten** after insert (preserves the original price for drop calculations).
- **`listings.db`, `sweep_batches/`, `*.xlsx`, `node_modules/` are gitignored** — they're data/artifacts, not code.
- The `.tmp`-read download trick is the working browser→disk transfer; the user can make it smoother by disabling Chrome's "ask where to save" prompt.
