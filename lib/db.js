import Database from 'better-sqlite3';
import path from 'node:path';

// Open the tracker DB read-only (the scraper owns writes). WAL lets us read while it writes.
let _db;
function db() {
  if (!_db) {
    const file = path.join(process.cwd(), 'listings.db');
    _db = new Database(file, { readonly: true, fileMustExist: true });
    _db.pragma('busy_timeout = 3000');
  }
  return _db;
}

const VAN_RE = /sprinter|transit|promaster|metris|nv\d|e-?series|express|econoline|savana|e1\d0|e2\d0|e3\d0|\bvan\b/i;
const JUNK_RE = /\/day|\/week|per day|rental|for rent|parts? out|parting|bench seat|seat only|wheels? only|tires? only|for parts/i;

function isVan(r) { return VAN_RE.test(`${r.model || ''} ${r.trim || ''} ${r.raw_text || ''}`); }
function isJunk(r) {
  const t = (r.raw_text || '').toLowerCase();
  if (JUNK_RE.test(t)) return true;
  if (r.price_num != null && r.price_num < 800) return true;
  if (r.price_num != null && r.price_num > 400000) return true;
  if (!r.year && !/sprinter|transit|promaster|van/i.test(t)) return true;
  return false;
}

const SORTABLE = new Set([
  'price_num', 'year', 'make', 'model', 'mileage_num', 'state', 'city',
  'first_seen', 'last_seen', 'listed_date', 'times_seen',
]);

export function queryListings(params = {}) {
  const {
    q, make, state, vansOnly, hideJunk, activeOnly,
    minPrice, maxPrice, maxMileage,
    sort = 'last_seen', dir = 'desc',
  } = params;

  const where = [];
  const args = {};
  if (make) { where.push('make = @make'); args.make = make; }
  if (state) { where.push('state = @state'); args.state = state; }
  if (activeOnly) where.push('is_active = 1');
  if (minPrice) { where.push('price_num >= @minPrice'); args.minPrice = Number(minPrice); }
  if (maxPrice) { where.push('price_num <= @maxPrice'); args.maxPrice = Number(maxPrice); }
  if (maxMileage) { where.push('(mileage_num IS NULL OR mileage_num <= @maxMileage)'); args.maxMileage = Number(maxMileage); }
  if (q) { where.push('raw_text LIKE @q'); args.q = `%${q}%`; }

  const sortCol = SORTABLE.has(sort) ? sort : 'last_seen';
  const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const sql = `SELECT * FROM listings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${sortCol} IS NULL, ${sortCol} ${sortDir}`;

  let rows = db().prepare(sql).all(args);

  // computed flags / fields (kept out of SQL so the regex stays in one place)
  rows = rows.map(r => {
    const van = isVan(r);
    const junk = isJunk(r);
    const priceDrop = (r.first_price != null && r.price_num != null && r.price_num < r.first_price)
      ? r.first_price - r.price_num : null;
    return { ...r, van, junk, price_drop: priceDrop };
  });

  if (vansOnly) rows = rows.filter(r => r.van);
  if (hideJunk) rows = rows.filter(r => !r.junk);

  return rows;
}

export function facets() {
  const d = db();
  const makes = d.prepare(`SELECT make, COUNT(*) n FROM listings WHERE make<>'' GROUP BY make ORDER BY n DESC`).all();
  const states = d.prepare(`SELECT state, COUNT(*) n FROM listings WHERE state<>'' GROUP BY state ORDER BY n DESC`).all();
  const total = d.prepare(`SELECT COUNT(*) n, SUM(is_active) active FROM listings`).get();
  return { makes, states, total };
}

export function priceHistory(id) {
  return db().prepare(`SELECT seen_at, price_num FROM observations WHERE id = ? ORDER BY seen_at`).all(id);
}
