// Per-metro enable/disable state (Postgres `metros` table), seeded from the
// catalog in grid.cjs. CJS so both the scheduler (CJS) and Next API (ESM, via
// default import) can use it. The scraper/search use enabledCitiesFor().
const pg = require('./pg');
const grid = require('./grid.cjs');
const { query } = pg;

let _ensured = false;
async function ensureMetroTable() {
  if (_ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS metros (
      slug    TEXT PRIMARY KEY,
      region  TEXT NOT NULL,
      label   TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);
  // seed / refresh catalog entries (preserve each metro's enabled flag)
  for (const m of grid.CATALOG) {
    await query(
      `INSERT INTO metros (slug, region, label, enabled) VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (slug) DO UPDATE SET region=EXCLUDED.region, label=EXCLUDED.label`,
      [m.slug, m.region, m.label]
    );
  }
  _ensured = true;
}

async function listMetros() {
  await ensureMetroTable();
  const rows = (await query(`SELECT slug, region, label, enabled FROM metros`)).rows;
  const order = grid.REGION_ORDER;
  rows.sort((a, b) => (order.indexOf(a.region) - order.indexOf(b.region)) || a.label.localeCompare(b.label));
  return rows;
}

async function setEnabled(slug, enabled) {
  await ensureMetroTable();
  await query(`UPDATE metros SET enabled=$2 WHERE slug=$1`, [slug, !!enabled]);
  return (await query(`SELECT slug, region, label, enabled FROM metros WHERE slug=$1`, [slug])).rows[0] || null;
}

async function setRegionEnabled(region, enabled) {
  await ensureMetroTable();
  if (!region || region === 'all') await query(`UPDATE metros SET enabled=$1`, [!!enabled]);
  else await query(`UPDATE metros SET enabled=$2 WHERE region=$1`, [region, !!enabled]);
}

// Enabled slugs for a region (or the whole nation). Falls back to the static
// catalog if the table somehow has no enabled rows for the region.
async function enabledCitiesFor(region) {
  await ensureMetroTable();
  const params = [];
  let sql = `SELECT slug FROM metros WHERE enabled`;
  if (region && region !== 'all') { params.push(region); sql += ` AND region=$1`; }
  const rows = (await query(sql, params)).rows;
  return rows.map(r => r.slug);
}

module.exports = { ensureMetroTable, listMetros, setEnabled, setRegionEnabled, enabledCitiesFor };
