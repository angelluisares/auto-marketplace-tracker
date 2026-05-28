# Project Handoff — Auto Marketplace Tracker

This document hands the project off to a **Claude Code session on another machine**. Read it fully before doing any work. It explains the goal, the architecture, the **preferred scraping method**, how to **connect to the shared hosted database**, the current state, and exactly where to pick up.

---

## 0. QUICK START (do this first on the new machine)

```bash
git clone https://github.com/angelluisares/auto-marketplace-tracker.git
cd auto-marketplace-tracker
npm install

# Connect to the SHARED hosted database (see §2):
cp .env.example .env.local
#   then edit .env.local and paste the real Neon DATABASE_URL
#   (get it from Angel / the Neon dashboard — it is NOT in the repo)

# Verify you can reach the shared DB and see the data:
node -e "require('dotenv').config({path:'.env.local'});const{Pool}=require('pg');new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}).query('SELECT count(*) FROM listings').then(r=>{console.log('listings in shared DB:',r.rows[0].count);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"

# Run the web UI against the shared DB:
npm run dev          # http://localhost:3000
```

If the count prints (should be ~286+), you're connected to the same database as the other machine.

---

## 1. What we are building

A tool that **tracks used-vehicle listings from Facebook Marketplace over time** — browse/sort/filter them and see how they change (price drops, days listed, when they disappear). Scope is **ALL vehicles** (renamed from `sprinter-tracker` → `auto-marketplace-tracker`; van/junk classifiers are now optional filters, not the focus).

**End goal:** a multi-user web app on a public URL. Stages:
1. ✅ Scrape pipeline → DB
2. ✅ Local web front end (Next.js)
3. ✅ **Shared hosted Postgres (Neon)** so multiple machines write to ONE dataset ← we are here
4. ⬜ Finish full scrape coverage + broaden beyond vans
5. ⬜ Deploy the web app publicly (multi-user), add auth
6. ⬜ Scheduled re-scrapes + price-drop alerts
7. ⬜ (Later) migrate Neon → coworker's self-hosted Postgres — see §7

---

## 2. The shared database (Neon Postgres) — how to connect

**The database is now hosted Postgres on Neon, NOT a local SQLite file.** This is what lets multiple machines scrape into one shared dataset. Both machines (and the web app) connect to the same DB over the network.

- The connection string lives ONLY in **`.env.local`** (gitignored). It is **NOT in the repo** because the repo is public. Get the real `DATABASE_URL` from Angel or the Neon dashboard and put it in `.env.local` (copy `.env.example` as the template).
- `lib/pg.js` is the shared connection pool + schema (standard Postgres, SSL required). Both the CLI scripts and the Next.js app use it.
- The schema is **vendor-neutral standard Postgres** (no Neon-only features) so it can be `pg_dump`'d to any server later (§7).
- **SECURITY:** never commit `.env.local` or paste the connection string into any tracked file. The `.gitignore` already excludes `.env*` files. If a credential leaks, rotate the Neon role password in the dashboard.

---

## 3. THE PREFERRED SCRAPING METHOD (read carefully)

**Use the LOGGED-OUT Marketplace, and get geographic coverage by SUBSTITUTING CITY SLUGS in the URL. This is the preferred method. Do not log in.**

### Why logged-out + city substitution is preferred
- No account, no credentials, no login → avoids account-flagging/ban risk from heavy automated scraping. Sustainable and safe to run repeatedly; appropriate for a public app.
- Marketplace search + listing pages are publicly viewable. A login modal pops up but is **dismissable** (it's NOT an auth wall — data is in the page behind it).

### How it works
URL pattern:
```
https://www.facebook.com/marketplace/<CITY_SLUG>/search?query=<QUERY>
```
- `<CITY_SLUG>` controls location: `greenville`, `charlotte`, `atlanta`, `knoxville`, `nashville`, `augusta`, `raleigh`, `charleston`, `birmingham`, `huntsville`, …
- `<QUERY>` is the search term: `mercedes sprinter`, `cargo van`, etc.

### Constraints + the strategy that beats them
- **Logged-out caps each search at ~40 results** (no infinite scroll). You cannot get hundreds from one search.
- **No radius control logged-out** (~40 mi default around the city); cannot use a saved account location.
- **STRATEGY:** run **many small searches across a GRID of city slugs × queries**, then **union and dedup by listing ID**. ~10 cities × 2–3 queries × ~40 each → a few hundred unique listings over a wide region. Adjacent-city overlap (~15–20%) is fine — dedup handles it.

### Logged-in (why we DON'T use it)
Logged-in allows one ~600-result 500-mi scrape, but requires an account and carries flagging risk. We deliberately chose logged-out. Only revisit if logged-out coverage proves insufficient.

### Bonus: listed date
Logged-out **detail pages** expose "Listed X ago"; the pipeline resolves it to an approx `listed_date`. Optional enrichment; when absent, our own `first_seen` is the backup.

---

## 4. How a scrape is executed (mechanics + gotchas)

Scraping is driven by **Claude operating a Chrome browser** via the Claude-in-Chrome extension (FB blocks headless/scripted access, so it must run through a real browser Claude drives).

### Per-search procedure
1. `navigate` the controlled tab to the city/query search URL.
2. JS snippet: dismiss the login modal (find `[role="dialog"]` → click close by `aria-label`), then **scroll to the bottom repeatedly** (`window.scrollTo(0, document.documentElement.scrollHeight)` with ~1.5s waits) until the count stops growing (~40 cap).
3. From every `a[href*="/marketplace/item/"]`: extract the listing **ID** from the URL + the card's `innerText`.
4. Output `{ source, records: [{id, text}] }`.

### CRITICAL GOTCHA — browser → disk transfer
Blocked channels: downloads-with-Save-As-prompt (dialog blocks), page→localhost POST (Private Network Access), large eval returns (tool view truncates ~1KB).
**What works:** trigger a Blob download from the page (name it **`.txt`**, type `text/plain`). Chrome writes the FULL data to a random **`.tmp`** in `~/Downloads` (held pending rename, but content is complete). Immediately read the newest `*.tmp` and `mv` it to `sweep_batches/<city>_<query>.json`.
- The user can smooth this by disabling Chrome → Settings → Downloads → "Ask where to save each file before downloading."
- The extension occasionally disconnects / CDP screenshot+click pipeline hangs (~300s). The **JS eval channel and `navigate` are most reliable** — prefer them over coordinate clicks/screenshots. Retry on transient disconnects.

---

## 5. Architecture & files

```
auto-marketplace-tracker/
├── marketplace_tracker.cjs   # CORE: ingest scrape batches -> Postgres (dedup, history, price drops); xlsx export
├── migrate_sqlite_to_pg.cjs  # one-time backfill of an old local listings.db into Postgres (already run)
├── lib/
│   ├── pg.js                 # shared Postgres pool + standard-PG schema (ensureSchema)
│   ├── parse.js              # pure parsers + isVan/isJunk classifiers (shared by CLI and web)
│   └── db.js                 # web-app read layer: queryListings / facets / priceHistory (Postgres)
├── app/
│   ├── page.js               # UI: sortable/filterable table (client component)
│   ├── layout.js
│   └── api/listings/route.js # GET /api/listings?… (async; reads Postgres)
├── next.config.mjs           # serverExternalPackages: ['pg','better-sqlite3']
├── .env.example              # template; copy to .env.local with real DATABASE_URL
├── README.md
├── HANDOFF.md                # this file
└── sweep_batches/            # raw scrape output (gitignored)
```

### Data model (Postgres)
- **`listings`** — one row per UNIQUE listing (current state), keyed by FB `id`: `price_num`, `first_price` (price first seen, never overwritten), `first_seen`, `last_seen`, `times_seen`, `is_active`, content `hash`, `listed_date`, parsed `year/make/model/trim/roof/wheelbase/drivetrain/mileage_num/city/state`, `raw_text`.
- **`observations`** — append-only log; one row every time a listing is seen (`id`, `seen_at`, `price_num`, `hash`, `raw_text`) → full price history. `listings` = current state; `observations` = history.

### Ingest behavior (built & tested)
- **Dedup by `id`** (UPSERT). New → insert with `first_seen`; existing → bump `last_seen`/`times_seen`.
- **Change detection** via content `hash`; **price drops** when current < previous.
- **Staleness-based deactivation:** mark `is_active=FALSE` only when `last_seen` older than `staleDays` (default 7). A PARTIAL sweep must NOT deactivate everything absent. **Keep this.**
- **`first_price` is never updated** after insert.

### CLI
```bash
node marketplace_tracker.cjs ingest <batch-or-merged.json> [--export]
node marketplace_tracker.cjs export        # regenerate xlsx from the DB
```
Batch shape: `[{ "id":"...", "text":"$45,000 | 2024 Mercedes-Benz sprinter ... | City, ST | 24K miles", "listed_rel":"Listed 3 weeks ago" (optional) }]`
To ingest the whole `sweep_batches/` folder: merge files (union + dedup by id) into one JSON array, then `ingest` it.

---

## 6. Web front end

- Next.js (App Router) + React. `lib/db.js` queries Postgres (async). `GET /api/listings` params: `q, make, state, vansOnly, hideJunk, activeOnly, minPrice, maxPrice, maxMileage, sort, dir`. `app/page.js` = sortable/filterable table with make/state facets.
- Defaults: **all vehicles** (Vans-only optional, OFF), **Hide junk** ON.
- Run: `npm run dev` → http://localhost:3000

---

## 7. Migrating Neon → coworker's self-hosted Postgres (later)

The schema is standard Postgres, so this is a plain dump/restore — app code doesn't change, only `DATABASE_URL`:
```bash
pg_dump "<neon DATABASE_URL>" -Fc -f backup.dump
pg_restore -d "<his server DATABASE_URL>" backup.dump
# then update DATABASE_URL in each machine's .env.local
```

---

## 8. CURRENT STATE — where to pick up

- ✅ **Hosted Neon Postgres is live and is the source of truth.** Schema created; **286 listings + 286 observations migrated in** (from the original local SQLite scrape). Web app + CLI both point at it.
- ✅ Repo is **public**: https://github.com/angelluisares/auto-marketplace-tracker
- ⚠️ The old local `listings.db` and `sweep_batches/` are gitignored — a fresh clone has **code but no local data**. That's fine: the data now lives in the shared Postgres, which you reach via `.env.local`.

### Scrape coverage so far
- **9 of ~20 planned searches done** (greenville ×2, charlotte ×2, atlanta ×2, knoxville ×2, nashville ×1) → the 286 listings now in Postgres.
- **NEXT STEP: finish the remaining ~11 searches** (nashville/cargo van; plus augusta, raleigh, charleston, birmingham, huntsville × their queries) using the logged-out + city-substitution method (§3–4). After each batch lands in `sweep_batches/`, merge and `node marketplace_tracker.cjs ingest <merged>.json` — it UPSERTs into the shared Postgres, so running it from EITHER machine adds to the same dataset.

### Then
- Broaden queries beyond vans (scope is all vehicles) — consider `/marketplace/<city>/vehicles` category pages, not just `search?query=`.
- Re-run the sweep over multiple days to accumulate real `observations` history (price drops, days-listed). Eventually schedule it.
- Deploy the Next.js app publicly + add auth (multi-user end goal).

---

## 9. Don't break these
- **Logged-out + city substitution** is the chosen scraping method (don't switch to logged-in without a deliberate reason).
- **Staleness-based deactivation** (don't deactivate on single-batch absence).
- **`first_price` never overwritten** after insert.
- **`.env*`, `node_modules/`, `sweep_batches/`, `*.xlsx`, `*.db` are gitignored** — never commit data or secrets (repo is public).
- The `.tmp`-read trick is the working browser→disk transfer.
