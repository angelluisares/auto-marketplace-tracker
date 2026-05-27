// Marketplace listing tracker: parse raw scrape -> SQLite (dedup + history) -> xlsx export.
//
// Usage:
//   node marketplace_tracker.cjs ingest <raw.json>   # upsert a scrape batch into listings.db
//   node marketplace_tracker.cjs export              # regenerate xlsx from listings.db
//   node marketplace_tracker.cjs ingest <raw.json> --export   # do both
//
// raw.json = [{ "id": "<fb item id>", "text": "$45,000 | 2024 Mercedes-Benz sprinter ... | City, ST | 24K miles" }, ...]

const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = 'listings.db';
const XLSX_PATH = 'Sprinter_and_Vehicles_Marketplace.xlsx';

// ---------------------------------------------------------------- parsing
const MAKES = [
  'Mercedes-Benz','Mercedes','Freightliner','Dodge','Ford','Ram','Nissan','Chevrolet','GMC',
  'BMW','Audi','Porsche','Lexus','Land Rover','Toyota','Volkswagen','Honda','Mini','MINI',
  'Ducati','Kawasaki','Yamaha','Husqvarna','KTM','Harley-Davidson','Moto Guzzi','Suzuki','Surron','Sur-Ron','Talaria','Segway',
  'Winnebago','Thor Motor Coach','Jayco','Entegra Coach','Forest River','Keystone','Tiffin Motorhomes','Gulf Stream','Dynamax','Itasca','inTech RV','inTech','Intech','Storyteller Overland','Air Opus','Airstream',
  'Sea Ray','Sea Doo','Sea-Doo','SeaDoo','Seadoo','Malibu','Nautique','Cobalt','Bayliner','Stingray','Scarab','Formula','Aviara','Chris Craft','Moomba','Stratus',
  'Mahindra','Vanderhall','Polaris','Can-Am','Rivian','Lotus','International','Oshkosh','Isuzu','Cushman','Club Car','EZGO','Evolution','MOKE','Daihatsu','Mitsubishi','Acura','Hummer','Cannondale','John Deere','Bombardier','NIU','Alta Motors','BrightDrop','Volvo','Jeep','Kia','Hyundai'
].sort((a, b) => b.length - a.length);

// Resolve FB "Listed 5 weeks ago" / "Listed 3 days ago" relative text to an approx ISO date.
function resolveListedDate(relText, refDate) {
  if (!relText) return null;
  const m = relText.match(/(\d+)\s*(minute|hour|day|week|month|year)/i);
  const ref = refDate ? new Date(refDate) : new Date();
  if (/just now|moments? ago/i.test(relText)) return ref.toISOString().slice(0, 10);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const days = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 }[unit] || 0;
  const d = new Date(ref.getTime() - n * days * 86400000);
  return d.toISOString().slice(0, 10);
}

function parseListing(id, text, listedDate) {
  const parts = text.split('|').map(s => s.trim()).filter(Boolean);
  const row = {
    id, price: '', orig_price: '', year: '', make: '', model: '', trim: '',
    roof: '', wheelbase: '', drivetrain: '', mileage: '', city: '', state: '',
    just_listed: '', dealership: '', listed_date: null,
    url: 'https://www.facebook.com/marketplace/item/' + id,
    raw_text: text,
  };
  let segs = parts.slice();

  if (segs[0] && /just listed/i.test(segs[0])) { row.just_listed = 'Yes'; segs.shift(); }

  const priceRe = /^\$[\d,]+$/;
  if (segs[0] && priceRe.test(segs[0])) row.price = segs.shift();
  if (segs[0] && priceRe.test(segs[0])) row.orig_price = segs.shift();

  let tail = segs[segs.length - 1] || '';
  if (/dealership/i.test(tail)) {
    row.dealership = 'Yes';
    tail = tail.replace(/·?\s*dealership/i, '').trim();
    if (tail) segs[segs.length - 1] = tail; else segs.pop();
  }
  const mileRe = /^[\d.]+k?\s*miles$/i;
  if (segs.length && mileRe.test(segs[segs.length - 1])) row.mileage = segs.pop();

  const locIdx = segs.findIndex(s => /,\s*[A-Z]{2}$/.test(s));
  if (locIdx !== -1) {
    const loc = segs.splice(locIdx, 1)[0];
    const m = loc.match(/^(.*),\s*([A-Z]{2})$/);
    if (m) { row.city = m[1].trim(); row.state = m[2]; }
  }

  const title = segs.join(' ').trim();
  const ym = title.match(/^((?:19|20)\d{2})\s+(.*)$/);
  let rest = title;
  if (ym) { row.year = ym[1]; rest = ym[2]; }

  for (const mk of MAKES) {
    const re = new RegExp('^' + mk.replace(/-/g, '\\-') + '\\b', 'i');
    if (re.test(rest)) { row.make = mk; rest = rest.slice(mk.length).trim(); break; }
  }
  if (!row.make) {
    if (/\bsprinter\b/i.test(rest)) row.make = 'Mercedes-Benz';
    else if (/\btransit\b/i.test(rest)) row.make = 'Ford';
    else if (/\bpromaster\b/i.test(rest)) row.make = 'Ram';
  }
  if (rest) {
    const toks = rest.split(/\s+/);
    row.model = (toks.shift() || '').replace(/^[a-z]/, c => c.toUpperCase());
    row.trim = toks.join(' ');
  }

  const full = title.toLowerCase();
  if (/high roof/.test(full)) row.roof = 'High';
  else if (/standard roof/.test(full)) row.roof = 'Standard';
  else if (/medium roof/.test(full)) row.roof = 'Medium';
  if (/170"?\s*wb|170 wb|\b170\b/.test(full)) row.wheelbase = '170';
  else if (/144"?\s*wb|144 wb|\b144\b/.test(full)) row.wheelbase = '144';
  if (/4x4|awd|4wd|xdrive|quattro|sdrive/.test(full)) row.drivetrain = '4x4/AWD';
  else if (/\brwd\b/.test(full)) row.drivetrain = 'RWD';

  row.price_num = row.price ? Number(row.price.replace(/[^\d]/g, '')) : null;
  row.orig_num = row.orig_price ? Number(row.orig_price.replace(/[^\d]/g, '')) : null;
  row.mileage_num = null;
  if (row.mileage) {
    const mm = row.mileage.match(/([\d.]+)(k?)/i);
    if (mm) row.mileage_num = Math.round(parseFloat(mm[1]) * (/k/i.test(mm[2]) ? 1000 : 1));
  }
  // content hash for change detection (the fields that meaningfully define the listing)
  row.hash = crypto.createHash('sha1')
    .update([row.price_num, row.year, row.make, row.model, row.trim, row.mileage_num, row.city, row.state].join('¦'))
    .digest('hex').slice(0, 12);
  if (listedDate) row.listed_date = listedDate; // already an ISO date from enrichment
  return row;
}

// ---------------------------------------------------------------- db
function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      first_seen TEXT NOT NULL,
      last_seen  TEXT NOT NULL,
      times_seen INTEGER NOT NULL DEFAULT 1,
      is_active  INTEGER NOT NULL DEFAULT 1,
      hash TEXT,
      price_num INTEGER, orig_num INTEGER,
      first_price INTEGER,            -- price the very first time we saw it
      listed_date TEXT,               -- FB "Listed X ago" resolved to a date, when available (else blank)
      year TEXT, make TEXT, model TEXT, trim TEXT,
      roof TEXT, wheelbase TEXT, drivetrain TEXT,
      mileage TEXT, mileage_num INTEGER,
      city TEXT, state TEXT,
      just_listed TEXT, dealership TEXT,
      url TEXT, raw_text TEXT,
      last_changed TEXT               -- last time the hash changed
    );
    CREATE TABLE IF NOT EXISTS observations (
      id TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      price_num INTEGER,
      hash TEXT,
      raw_text TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_obs_id ON observations(id);
  `);
  return db;
}

function ingest(rawPath, opts = {}) {
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const now = new Date().toISOString();
  const db = openDb();

  const getExisting = db.prepare('SELECT id, hash, price_num, first_price, last_changed FROM listings WHERE id = ?');
  const insert = db.prepare(`INSERT INTO listings
    (id, first_seen, last_seen, times_seen, is_active, hash, price_num, orig_num, first_price, listed_date,
     year, make, model, trim, roof, wheelbase, drivetrain, mileage, mileage_num, city, state,
     just_listed, dealership, url, raw_text, last_changed)
    VALUES (@id,@now,@now,1,1,@hash,@price_num,@orig_num,@price_num,@listed_date,
     @year,@make,@model,@trim,@roof,@wheelbase,@drivetrain,@mileage,@mileage_num,@city,@state,
     @just_listed,@dealership,@url,@raw_text,@now)`);
  // listed_date: only overwrite when this batch actually carries one (detail-page enrichment); else keep prior.
  const update = db.prepare(`UPDATE listings SET
     last_seen=@now, times_seen=times_seen+1, is_active=1, hash=@hash,
     price_num=@price_num, orig_num=@orig_num,
     listed_date=COALESCE(@listed_date, listed_date),
     year=@year, make=@make, model=@model, trim=@trim, roof=@roof, wheelbase=@wheelbase,
     drivetrain=@drivetrain, mileage=@mileage, mileage_num=@mileage_num, city=@city, state=@state,
     just_listed=@just_listed, dealership=@dealership, url=@url, raw_text=@raw_text,
     last_changed=@last_changed
     WHERE id=@id`);
  // first_price is intentionally never updated after insert — it preserves the original price.
  const obs = db.prepare('INSERT INTO observations (id, seen_at, price_num, hash, raw_text) VALUES (@id,@now,@price_num,@hash,@raw_text)');

  let added = 0, changed = 0, priceDrops = [], seenIds = [];

  const run = db.transaction(() => {
    for (const r of raw) {
      if (!r.id || !r.text) continue;
      const listed = r.listed_rel ? resolveListedDate(r.listed_rel, now) : (r.listed_date || null);
      const row = parseListing(r.id, r.text, listed);
      seenIds.push(row.id);
      const ex = getExisting.get(row.id);
      if (!ex) {
        insert.run({ ...row, now });
        added++;
      } else {
        const hashChanged = ex.hash !== row.hash;
        // preserve prior last_changed when nothing changed; stamp now when it did
        const lastChanged = hashChanged ? now : (ex.last_changed || now);
        update.run({ ...row, now, last_changed: lastChanged });
        if (hashChanged) {
          changed++;
          if (ex.price_num != null && row.price_num != null && row.price_num < ex.price_num) {
            priceDrops.push({ id: row.id, from: ex.price_num, to: row.price_num,
              title: `${row.year} ${row.make} ${row.model}`.trim(), url: row.url });
          }
        }
      }
      obs.run({ ...row, now });
    }
    // Deactivation: a multi-city van sweep is PARTIAL, so we must not mark every
    // absent listing inactive. Instead, mark inactive only listings we haven't
    // seen in `staleDays` days (default 7) — i.e. genuinely gone, not just out-of-sweep.
    const staleDays = opts.staleDays ?? 7;
    const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
    const before = db.prepare('SELECT COUNT(*) c FROM listings WHERE is_active=1').get().c;
    db.prepare('UPDATE listings SET is_active=0 WHERE is_active=1 AND last_seen < ?').run(cutoff);
    const after = db.prepare('SELECT COUNT(*) c FROM listings WHERE is_active=1').get().c;
    return before - after;
  });
  const deactivated = run();

  const totals = db.prepare('SELECT COUNT(*) total, SUM(is_active) active FROM listings').get();
  console.log(`Ingest @ ${now}`);
  console.log(`  batch listings:   ${seenIds.length}`);
  console.log(`  new:              ${added}`);
  console.log(`  changed:          ${changed}`);
  console.log(`  price drops:      ${priceDrops.length}`);
  console.log(`  gone (inactive):  ${deactivated}`);
  console.log(`  DB total:         ${totals.total}  (active ${totals.active})`);
  if (priceDrops.length) {
    console.log('  --- price drops this run ---');
    priceDrops.slice(0, 25).forEach(d => console.log(`    $${d.from.toLocaleString()} -> $${d.to.toLocaleString()}  ${d.title}  ${d.url}`));
  }
  db.close();
}

// ---------------------------------------------------------------- export
async function exportXlsx() {
  const ExcelJS = require('exceljs');
  const db = openDb();
  const rows = db.prepare('SELECT * FROM listings ORDER BY last_seen DESC, first_seen DESC').all();
  db.close();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Marketplace tracker';
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

  const isVan = r => /sprinter|transit|promaster|metris|nv\d|e-?series|express|econoline|savana|e1\d0|e2\d0|e3\d0|\bvan\b/i.test(`${r.model} ${r.trim} ${r.raw_text}`);
  // junk = not really a buyable vehicle listing: rentals, parts, accessories, or absurd prices
  const isJunk = r => {
    const t = (r.raw_text || '').toLowerCase();
    if (/\/day|\/week|per day|rental|for rent|parts? out|parting|bench seat|seat only|wheels? only|tires? only|for parts/.test(t)) return 'Yes';
    if (r.price_num != null && r.price_num < 800) return 'Yes';        // sub-$800 = parts/scam/typo
    if (r.price_num != null && r.price_num > 400000) return 'Yes';     // absurd high = spam
    if (!r.year && !/sprinter|transit|promaster|van/i.test(t)) return 'Yes';
    return '';
  };
  const dOnly = iso => (iso || '').slice(0, 10);
  const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));

  const all = wb.addWorksheet('All Vehicles', { views: [{ state: 'frozen', ySplit: 1 }] });
  const vans = wb.addWorksheet('Vans', { views: [{ state: 'frozen', ySplit: 1 }] });
  for (const ws of [all, vans]) {
    ws.columns = cols;
    const src = ws === vans ? rows.filter(isVan) : rows;
    src.forEach(r => {
      const drop = (r.first_price != null && r.price_num != null && r.price_num < r.first_price)
        ? r.first_price - r.price_num : null;
      const row = ws.addRow({
        ...r,
        van: isVan(r) ? 'Yes' : '',
        junk: isJunk(r),
        price_drop: drop,
        first_seen_d: dOnly(r.first_seen),
        last_seen_d: dOnly(r.last_seen),
        days_listed: daysBetween(r.first_seen, r.last_seen),
        active: r.is_active ? 'Yes' : 'No',
      });
      if (isJunk(r)) row.getCell('junk').font = { color: { argb: 'FFC00000' }, bold: true };
      const link = row.getCell('url');
      link.value = { text: 'View', hyperlink: r.url };
      link.font = { color: { argb: 'FF0563C1' }, underline: true };
      if (drop) row.getCell('price_drop').font = { color: { argb: 'FF008000' }, bold: true };
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
      // file is open (Excel/OneDrive lock) — write a timestamped copy instead so the run never fails
      const alt = XLSX_PATH.replace(/\.xlsx$/, `_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'')}.xlsx`);
      await wb.xlsx.writeFile(alt);
      console.log(`Primary xlsx was locked (open in Excel/OneDrive). Wrote ${alt} instead  (All ${rows.length} | Vans ${rows.filter(isVan).length})`);
    } else throw e;
  }
}

// ---------------------------------------------------------------- cli
(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'ingest') {
    if (!arg) { console.error('need raw.json path'); process.exit(1); }
    ingest(arg);
    if (process.argv.includes('--export')) await exportXlsx();
  } else if (cmd === 'export') {
    await exportXlsx();
  } else {
    console.log('usage: node marketplace_tracker.cjs ingest <raw.json> [--export] | export');
  }
})();
