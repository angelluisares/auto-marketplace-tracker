// Marketplace listing tracker: parse raw scrape -> Postgres (dedup + history) -> xlsx export.
//
// Usage:
//   node marketplace_tracker.cjs ingest <raw.json> [--export]   # upsert a scrape batch
//   node marketplace_tracker.cjs export                         # regenerate xlsx from DB
//
// raw.json = [{ "id": "<fb item id>", "text": "$45,000 | 2024 Mercedes-Benz sprinter ... | City, ST | 24K miles", "listed_rel": "Listed 3 weeks ago" (optional) }]

const fs = require('fs');
const { parseListing, resolveListedDate, isVan, isJunk } = require('./lib/parse');
const { query, ensureSchema, pool } = require('./lib/pg');

const XLSX_PATH = 'Auto_Marketplace_Listings.xlsx';

// ---------------------------------------------------------------- ingest
async function ingest(rawPath, opts = {}) {
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const now = new Date().toISOString();
  await ensureSchema();

  let added = 0, changed = 0, priceDrops = [];
  const seenIds = [];

  for (const r of raw) {
    if (!r.id || !r.text) continue;
    const listed = r.listed_rel ? resolveListedDate(r.listed_rel, now) : (r.listed_date || null);
    const row = parseListing(r.id, r.text, listed);
    seenIds.push(row.id);

    const ex = (await query('SELECT id, hash, price_num, first_price, last_changed FROM listings WHERE id=$1', [row.id])).rows[0];

    if (!ex) {
      await query(
        `INSERT INTO listings
          (id, first_seen, last_seen, times_seen, is_active, hash, price_num, orig_num, first_price, listed_date,
           year, make, model, trim, roof, wheelbase, drivetrain, mileage, mileage_num, city, state,
           just_listed, dealership, url, raw_text, last_changed)
         VALUES ($1,$2,$2,1,TRUE,$3,$4,$5,$4,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$2)`,
        [row.id, now, row.hash, row.price_num, row.orig_num, row.listed_date,
         row.year, row.make, row.model, row.trim, row.roof, row.wheelbase, row.drivetrain,
         row.mileage, row.mileage_num, row.city, row.state, row.just_listed, row.dealership, row.url, row.raw_text]
      );
      added++;
    } else {
      const hashChanged = ex.hash !== row.hash;
      const lastChanged = hashChanged ? now : (ex.last_changed || now);
      await query(
        `UPDATE listings SET
           last_seen=$2, times_seen=times_seen+1, is_active=TRUE, hash=$3,
           price_num=$4, orig_num=$5,
           listed_date=COALESCE($6, listed_date),
           year=$7, make=$8, model=$9, trim=$10, roof=$11, wheelbase=$12, drivetrain=$13,
           mileage=$14, mileage_num=$15, city=$16, state=$17, just_listed=$18, dealership=$19,
           url=$20, raw_text=$21, last_changed=$22
         WHERE id=$1`,
        [row.id, now, row.hash, row.price_num, row.orig_num, row.listed_date,
         row.year, row.make, row.model, row.trim, row.roof, row.wheelbase, row.drivetrain,
         row.mileage, row.mileage_num, row.city, row.state, row.just_listed, row.dealership,
         row.url, row.raw_text, lastChanged]
      );
      // first_price is intentionally never updated — preserves the original price.
      if (hashChanged) {
        changed++;
        if (ex.price_num != null && row.price_num != null && row.price_num < ex.price_num) {
          priceDrops.push({ from: ex.price_num, to: row.price_num, title: `${row.year} ${row.make} ${row.model}`.trim(), url: row.url });
        }
      }
    }
    await query('INSERT INTO observations (id, seen_at, price_num, hash, raw_text) VALUES ($1,$2,$3,$4,$5)',
      [row.id, now, row.price_num, row.hash, row.raw_text]);
  }

  // Staleness-based deactivation (partial sweeps must NOT deactivate everything absent).
  const staleDays = opts.staleDays ?? 7;
  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
  const before = (await query('SELECT COUNT(*)::int c FROM listings WHERE is_active')).rows[0].c;
  await query('UPDATE listings SET is_active=FALSE WHERE is_active AND last_seen < $1', [cutoff]);
  const totals = (await query('SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE is_active)::int active FROM listings')).rows[0];

  console.log(`Ingest @ ${now}`);
  console.log(`  batch listings:   ${seenIds.length}`);
  console.log(`  new:              ${added}`);
  console.log(`  changed:          ${changed}`);
  console.log(`  price drops:      ${priceDrops.length}`);
  console.log(`  gone (inactive):  ${before - totals.active}`);
  console.log(`  DB total:         ${totals.total}  (active ${totals.active})`);
  if (priceDrops.length) {
    console.log('  --- price drops this run ---');
    priceDrops.slice(0, 25).forEach(d => console.log(`    $${d.from.toLocaleString()} -> $${d.to.toLocaleString()}  ${d.title}  ${d.url}`));
  }
}

// ---------------------------------------------------------------- export
async function exportXlsx() {
  const ExcelJS = require('exceljs');
  await ensureSchema();
  const rows = (await query('SELECT * FROM listings ORDER BY last_seen DESC, first_seen DESC')).rows;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Auto Marketplace Tracker';
  wb.created = new Date();

  const cols = [
    { header: 'Price', key: 'price_num', width: 12, style: { numFmt: '$#,##0' } },
    { header: 'First Price', key: 'first_price', width: 12, style: { numFmt: '$#,##0' } },
    { header: 'Price Drop', key: 'price_drop', width: 11, style: { numFmt: '$#,##0' } },
    { header: 'Year', key: 'year', width: 7 },
    { header: 'Make', key: 'make', width: 16 },
    { header: 'Model', key: 'model', width: 14 },
    { header: 'Trim / Details', key: 'trim', width: 38 },
    { header: 'Van?', key: 'van', width: 6 },
    { header: 'Likely Junk', key: 'junk', width: 11 },
    { header: 'Roof', key: 'roof', width: 9 },
    { header: 'WB', key: 'wheelbase', width: 6 },
    { header: 'Drivetrain', key: 'drivetrain', width: 11 },
    { header: 'Mileage', key: 'mileage_num', width: 11, style: { numFmt: '#,##0' } },
    { header: 'City', key: 'city', width: 16 },
    { header: 'State', key: 'state', width: 7 },
    { header: 'Listed (FB)', key: 'listed_date', width: 12 },
    { header: 'First Seen', key: 'first_seen_d', width: 12 },
    { header: 'Last Seen', key: 'last_seen_d', width: 12 },
    { header: 'Days Listed', key: 'days_listed', width: 11 },
    { header: 'Times Seen', key: 'times_seen', width: 10 },
    { header: 'Active?', key: 'active', width: 8 },
    { header: 'Dealer?', key: 'dealership', width: 8 },
    { header: 'Link', key: 'url', width: 10 },
  ];

  const dOnly = v => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));

  const all = wb.addWorksheet('All Vehicles', { views: [{ state: 'frozen', ySplit: 1 }] });
  const vans = wb.addWorksheet('Vans', { views: [{ state: 'frozen', ySplit: 1 }] });
  for (const ws of [all, vans]) {
    ws.columns = cols;
    const src = ws === vans ? rows.filter(isVan) : rows;
    src.forEach(r => {
      const drop = (r.first_price != null && r.price_num != null && r.price_num < r.first_price) ? r.first_price - r.price_num : null;
      const row = ws.addRow({
        ...r,
        van: isVan(r) ? 'Yes' : '',
        junk: isJunk(r) ? 'Yes' : '',
        price_drop: drop,
        first_seen_d: dOnly(r.first_seen),
        last_seen_d: dOnly(r.last_seen),
        days_listed: daysBetween(r.first_seen, r.last_seen),
        active: r.is_active ? 'Yes' : 'No',
      });
      const link = row.getCell('url');
      link.value = { text: 'View', hyperlink: r.url };
      link.font = { color: { argb: 'FF0563C1' }, underline: true };
      if (drop) row.getCell('price_drop').font = { color: { argb: 'FF008000' }, bold: true };
      if (isJunk(r)) row.getCell('junk').font = { color: { argb: 'FFC00000' }, bold: true };
      if (!r.is_active) row.eachCell(c => { c.font = { ...(c.font || {}), color: { argb: 'FF999999' } }; });
    });
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    h.height = 20;
    ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
  }

  try {
    await wb.xlsx.writeFile(XLSX_PATH);
    console.log(`Exported ${XLSX_PATH}  (All ${rows.length} | Vans ${rows.filter(isVan).length})`);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      const alt = XLSX_PATH.replace(/\.xlsx$/, `_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.xlsx`);
      await wb.xlsx.writeFile(alt);
      console.log(`Primary xlsx was locked. Wrote ${alt} instead  (All ${rows.length} | Vans ${rows.filter(isVan).length})`);
    } else throw e;
  }
}

// ---------------------------------------------------------------- cli
(async () => {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'ingest') {
      if (!arg) { console.error('need raw.json path'); process.exit(1); }
      await ingest(arg);
      if (process.argv.includes('--export')) await exportXlsx();
    } else if (cmd === 'export') {
      await exportXlsx();
    } else {
      console.log('usage: node marketplace_tracker.cjs ingest <raw.json> [--export] | export');
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool().end();
  }
})();
