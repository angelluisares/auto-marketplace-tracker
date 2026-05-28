// Persistent search history + scheduling (Postgres). CJS so both the Next API
// (ESM, via default import) and the standalone scheduler (CJS) can use it.
const pg = require('./pg');
const { query } = pg;

let _ensured = false;
async function ensureSearchTable() {
  if (_ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS searches (
      id               SERIAL PRIMARY KEY,
      text             TEXT UNIQUE NOT NULL,
      query            TEXT,
      max_miles        INTEGER,
      max_price        INTEGER,
      min_year         INTEGER,
      max_year         INTEGER,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_run_at      TIMESTAMPTZ,
      run_count        INTEGER NOT NULL DEFAULT 0,
      last_found       INTEGER,
      scheduled        BOOLEAN NOT NULL DEFAULT FALSE,
      interval_minutes INTEGER,
      next_run_at      TIMESTAMPTZ,
      region           TEXT,
      last_duration_ms INTEGER
    );
  `);
  // add columns to tables created before they existed
  await query(`ALTER TABLE searches ADD COLUMN IF NOT EXISTS region TEXT`);
  await query(`ALTER TABLE searches ADD COLUMN IF NOT EXISTS last_duration_ms INTEGER`);
  _ensured = true;
}

// Upsert a search by its text and stamp a run (count++, last_found, last_run_at).
async function recordRun(parsed, found, region, durationMs) {
  await ensureSearchTable();
  await query(
    `INSERT INTO searches (text, query, max_miles, max_price, min_year, max_year, region, last_run_at, run_count, last_found, last_duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), 1, $8, $9)
     ON CONFLICT (text) DO UPDATE SET
       query=EXCLUDED.query, max_miles=EXCLUDED.max_miles, max_price=EXCLUDED.max_price,
       min_year=EXCLUDED.min_year, max_year=EXCLUDED.max_year, region=EXCLUDED.region,
       last_run_at=now(), run_count=searches.run_count+1, last_found=EXCLUDED.last_found,
       last_duration_ms=EXCLUDED.last_duration_ms,
       next_run_at = CASE WHEN searches.scheduled
                          THEN now() + make_interval(mins => searches.interval_minutes)
                          ELSE searches.next_run_at END`,
    [parsed.raw, parsed.query, parsed.maxMiles, parsed.maxPrice, parsed.minYear, parsed.maxYear, region || 'all', found, durationMs != null ? Math.round(durationMs) : null]
  );
}

async function listSearches() {
  await ensureSearchTable();
  return (await query(
    `SELECT * FROM searches ORDER BY scheduled DESC, last_run_at DESC NULLS LAST, created_at DESC`
  )).rows;
}

async function getSearch(id) {
  await ensureSearchTable();
  return (await query(`SELECT * FROM searches WHERE id=$1`, [id])).rows[0] || null;
}

async function setSchedule(id, scheduled, intervalMinutes) {
  await ensureSearchTable();
  if (scheduled) {
    await query(
      `UPDATE searches SET scheduled=TRUE, interval_minutes=$2,
         next_run_at = now() + make_interval(mins => $2) WHERE id=$1`,
      [id, intervalMinutes]
    );
  } else {
    await query(`UPDATE searches SET scheduled=FALSE, next_run_at=NULL WHERE id=$1`, [id]);
  }
  return getSearch(id);
}

async function deleteSearch(id) {
  await ensureSearchTable();
  await query(`DELETE FROM searches WHERE id=$1`, [id]);
}

async function dueSearches() {
  await ensureSearchTable();
  return (await query(
    `SELECT * FROM searches WHERE scheduled AND next_run_at IS NOT NULL AND next_run_at <= now()`
  )).rows;
}

// Convert a stored row into the parsed shape used by matchListings.
function rowToParsed(row) {
  return {
    raw: row.text, query: row.query,
    maxMiles: row.max_miles, maxPrice: row.max_price,
    minYear: row.min_year, maxYear: row.max_year,
  };
}

// Query current DB listings that match a parsed search (no scraping).
async function matchListings(parsed, limit = 200) {
  const { query: q, maxMiles, maxPrice, minYear, maxYear } = parsed;
  const where = [];
  const params = [];
  (q || '').split(/\s+/).filter(Boolean).forEach(t => { params.push('%' + t + '%'); where.push(`raw_text ILIKE $${params.length}`); });
  if (maxMiles != null) { params.push(maxMiles); where.push(`mileage_num IS NOT NULL AND mileage_num <= $${params.length}`); }
  if (maxPrice != null) { params.push(maxPrice); where.push(`price_num IS NOT NULL AND price_num <= $${params.length}`); }
  if (minYear != null) { params.push(String(minYear)); where.push(`year ~ '^[0-9]{4}$' AND year >= $${params.length}`); }
  if (maxYear != null) { params.push(String(maxYear)); where.push(`year ~ '^[0-9]{4}$' AND year <= $${params.length}`); }
  where.push(`(price_num IS NULL OR price_num >= 800)`);
  params.push(limit);
  const sql = `SELECT id, year, make, model, trim, price_num, first_price, mileage_num, city, state, url, raw_text
               FROM listings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY mileage_num ASC NULLS LAST LIMIT $${params.length}`;
  const rows = (await query(sql, params)).rows;
  return rows.map(r => ({
    ...r,
    price_drop: (r.first_price != null && r.price_num != null && r.price_num < r.first_price)
      ? r.first_price - r.price_num : null,
  }));
}

module.exports = {
  ensureSearchTable, recordRun, listSearches, getSearch, setSchedule,
  deleteSearch, dueSearches, matchListings, rowToParsed,
};
