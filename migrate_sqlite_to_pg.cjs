// One-time backfill: copy existing listings.db (SQLite) into Postgres, preserving
// first_seen / last_seen / times_seen / observations. Idempotent via ON CONFLICT.
//
//   node migrate_sqlite_to_pg.cjs [path-to-listings.db]
const Database = require('better-sqlite3');
const { query, ensureSchema, pool } = require('./lib/pg');

const SRC = process.argv[2] || 'listings.db';

(async () => {
  await ensureSchema();
  const sdb = new Database(SRC, { readonly: true, fileMustExist: true });

  const listings = sdb.prepare('SELECT * FROM listings').all();
  const obs = sdb.prepare('SELECT * FROM observations').all();

  const toIso = v => (v == null ? null : new Date(v).toISOString());
  const bool = v => !!v;

  let l = 0;
  for (const r of listings) {
    await query(
      `INSERT INTO listings
        (id, first_seen, last_seen, times_seen, is_active, hash, price_num, orig_num, first_price, listed_date,
         year, make, model, trim, roof, wheelbase, drivetrain, mileage, mileage_num, city, state,
         just_listed, dealership, url, raw_text, last_changed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, toIso(r.first_seen), toIso(r.last_seen), r.times_seen, bool(r.is_active), r.hash,
       r.price_num, r.orig_num, r.first_price, r.listed_date || null,
       r.year, r.make, r.model, r.trim, r.roof, r.wheelbase, r.drivetrain,
       r.mileage, r.mileage_num, r.city, r.state, r.just_listed, r.dealership, r.url, r.raw_text, toIso(r.last_changed)]
    );
    l++;
  }

  let o = 0;
  for (const r of obs) {
    await query('INSERT INTO observations (id, seen_at, price_num, hash, raw_text) VALUES ($1,$2,$3,$4,$5)',
      [r.id, toIso(r.seen_at), r.price_num, r.hash, r.raw_text]);
    o++;
  }

  const totals = (await query('SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE is_active)::int active FROM listings')).rows[0];
  console.log(`Migrated ${l} listings + ${o} observations from ${SRC}`);
  console.log(`Postgres now has ${totals.total} listings (active ${totals.active})`);
  sdb.close();
  await pool().end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
