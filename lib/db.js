// Web-app data layer — queries Postgres (shared remote DB). Read paths for the API.
import pg from './pg.js';
import { isVan, isJunk } from './parse.js';

const { query } = pg;

const SORTABLE = new Set([
  'price_num', 'year', 'make', 'model', 'mileage_num', 'state', 'city',
  'first_seen', 'last_seen', 'listed_date', 'times_seen',
]);

export async function queryListings(params = {}) {
  const {
    q, make, model, state, hideJunk, activeOnly,
    minPrice, maxPrice, maxMileage,
    sort = 'last_seen', dir = 'desc',
  } = params;

  const where = [];
  const args = [];
  const add = (clause, val) => { args.push(val); where.push(clause.replace('?', `$${args.length}`)); };

  if (make) add('make = ?', make);
  if (model) add('model = ?', model);
  if (state) add('state = ?', state);
  if (activeOnly) where.push('is_active');
  if (minPrice) add('price_num >= ?', Number(minPrice));
  if (maxPrice) add('price_num <= ?', Number(maxPrice));
  if (maxMileage) add('(mileage_num IS NULL OR mileage_num <= ?)', Number(maxMileage));
  if (q) add('raw_text ILIKE ?', `%${q}%`);

  const sortCol = SORTABLE.has(sort) ? sort : 'last_seen';
  const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const sql = `SELECT * FROM listings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${sortCol} ${sortDir} NULLS LAST`;

  let rows = (await query(sql, args)).rows;

  rows = rows.map(r => {
    const van = isVan(r);
    const junk = isJunk(r);
    const priceDrop = (r.first_price != null && r.price_num != null && r.price_num < r.first_price)
      ? r.first_price - r.price_num : null;
    return { ...r, van, junk, price_drop: priceDrop };
  });

  if (hideJunk) rows = rows.filter(r => !r.junk);
  return rows;
}

export async function facets() {
  const makes = (await query(`SELECT make, COUNT(*)::int n FROM listings WHERE make<>'' GROUP BY make ORDER BY n DESC`)).rows;
  const states = (await query(`SELECT state, COUNT(*)::int n FROM listings WHERE state<>'' GROUP BY state ORDER BY n DESC`)).rows;
  const total = (await query(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE is_active)::int active FROM listings`)).rows[0];
  return { makes, states, total };
}

// Distinct models for a given make (for the dependent Model dropdown).
export async function models(make) {
  if (!make) return [];
  return (await query(
    `SELECT model, COUNT(*)::int n FROM listings WHERE make=$1 AND model<>'' GROUP BY model ORDER BY n DESC, model`,
    [make]
  )).rows;
}

export async function priceHistory(id) {
  return (await query(`SELECT seen_at, price_num FROM observations WHERE id=$1 ORDER BY seen_at`, [id])).rows;
}
