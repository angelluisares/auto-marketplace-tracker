// Shared Postgres connection pool + schema. Vendor-neutral standard Postgres
// (no Neon-specific features) so the DB can be pg_dump'd to any server later.
const { Pool } = require('pg');

// Load .env.local for CLI scripts. Next.js loads env itself, so guard the require.
try { require('dotenv').config({ path: '.env.local' }); } catch { /* dotenv optional in some runtimes */ }

let _pool;
function pool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (check .env.local)');
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Neon (and most hosted PG) require SSL
      max: 5,
    });
  }
  return _pool;
}

async function query(text, params) {
  return pool().query(text, params);
}

// Standard Postgres DDL — portable to any PG server via pg_dump/pg_restore.
async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS listings (
      id           TEXT PRIMARY KEY,
      first_seen   TIMESTAMPTZ NOT NULL,
      last_seen    TIMESTAMPTZ NOT NULL,
      times_seen   INTEGER NOT NULL DEFAULT 1,
      is_active    BOOLEAN NOT NULL DEFAULT TRUE,
      hash         TEXT,
      price_num    INTEGER,
      orig_num     INTEGER,
      first_price  INTEGER,
      listed_date  DATE,
      year         TEXT,
      make         TEXT,
      model        TEXT,
      trim         TEXT,
      roof         TEXT,
      wheelbase    TEXT,
      drivetrain   TEXT,
      mileage      TEXT,
      mileage_num  INTEGER,
      city         TEXT,
      state        TEXT,
      just_listed  TEXT,
      dealership   TEXT,
      url          TEXT,
      raw_text     TEXT,
      last_changed TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS observations (
      id       TEXT NOT NULL,
      seen_at  TIMESTAMPTZ NOT NULL,
      price_num INTEGER,
      hash     TEXT,
      raw_text TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_obs_id ON observations(id);
    CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings(last_seen);
  `);
}

module.exports = { pool, query, ensureSchema };
