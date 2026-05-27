// Parse scraped FB Marketplace listings into a structured, filterable XLSX.
const fs = require('fs');

const raw = JSON.parse(fs.readFileSync('sprinter_listings_raw.json', 'utf8'));

const MAKES = [
  'Mercedes-Benz','Mercedes','Freightliner','Dodge','Ford','Ram','Nissan','Chevrolet','GMC',
  'BMW','Audi','Porsche','Lexus','Land Rover','Toyota','Volkswagen','Honda','Nissan','Mini','MINI',
  'Ducati','Kawasaki','Yamaha','Husqvarna','KTM','Harley-Davidson','Moto Guzzi','Suzuki','Surron','Sur-Ron','Talaria','Segway',
  'Winnebago','Thor Motor Coach','Jayco','Entegra Coach','Forest River','Keystone','Tiffin Motorhomes','Gulf Stream','Dynamax','Itasca','inTech RV','inTech','Intech','Storyteller Overland','Air Opus','Airstream',
  'Sea Ray','Sea Doo','Sea-Doo','SeaDoo','Seadoo','Malibu','Nautique','Cobalt','Bayliner','Stingray','Scarab','Formula','Aviara','Chris Craft','Moomba','Stratus',
  'Mahindra','Vanderhall','Polaris','Can-Am','Rivian','Lotus','International','Oshkosh','Isuzu','Cushman','Club Car','EZGO','Evolution','MOKE','Daihatsu','Mitsubishi','Acura','Hummer','Cannondale','John Deere','Bombardier','NIU','Alta Motors','BrightDrop','Volvo','Jeep','Kia','Hyundai'
];

function parse(rec) {
  const parts = rec.text.split('|').map(s => s.trim()).filter(Boolean);
  const row = {
    price: '', orig_price: '', year: '', make: '', model: '', trim: '',
    roof: '', wheelbase: '', drivetrain: '', mileage: '', city: '', state: '',
    just_listed: '', dealership: '', url: 'https://www.facebook.com/marketplace/item/' + rec.id
  };

  let segs = parts.slice();

  // "Just listed" flag
  if (segs[0] && /just listed/i.test(segs[0])) { row.just_listed = 'Yes'; segs.shift(); }

  // prices: FB shows current price first, then a struck-through original if discounted.
  const priceRe = /^\$[\d,]+$/;
  if (segs[0] && priceRe.test(segs[0])) { row.price = segs.shift(); }
  if (segs[0] && priceRe.test(segs[0])) { row.orig_price = segs.shift(); }

  // last seg may be mileage and/or dealership
  // dealership appears appended like "62K miles · Dealership" or "Dealership"
  let tail = segs[segs.length - 1] || '';
  if (/dealership/i.test(tail)) {
    row.dealership = 'Yes';
    tail = tail.replace(/·?\s*dealership/i, '').trim();
    if (tail) segs[segs.length - 1] = tail; else segs.pop();
    tail = segs[segs.length - 1] || '';
  }
  // mileage: "87K miles", "300 miles", "999K miles"
  const mileRe = /^[\d.]+k?\s*miles$/i;
  if (segs.length && mileRe.test(segs[segs.length - 1])) {
    row.mileage = segs.pop();
  }

  // location: "City, ST" — find seg with a comma + 2-letter state
  const locIdx = segs.findIndex(s => /,\s*[A-Z]{2}$/.test(s));
  if (locIdx !== -1) {
    const loc = segs.splice(locIdx, 1)[0];
    const m = loc.match(/^(.*),\s*([A-Z]{2})$/);
    if (m) { row.city = m[1].trim(); row.state = m[2]; }
  }

  // remaining: title "YEAR Make model trim..."
  const title = segs.join(' ').trim();
  const ym = title.match(/^((?:19|20)\d{2})\s+(.*)$/);
  let rest = title;
  if (ym) { row.year = ym[1]; rest = ym[2]; }

  // make
  for (const mk of MAKES.sort((a,b)=>b.length-a.length)) {
    const re = new RegExp('^' + mk.replace(/[-]/g,'\\-') + '\\b', 'i');
    if (re.test(rest)) { row.make = mk; rest = rest.slice(mk.length).trim(); break; }
  }

  // Fallback: bare "Sprinter"/"Transit"/"Promaster" with no recognized make → infer make
  if (!row.make) {
    if (/\bsprinter\b/i.test(rest)) row.make = 'Mercedes-Benz';
    else if (/\btransit\b/i.test(rest)) row.make = 'Ford';
    else if (/\bpromaster\b/i.test(rest)) row.make = 'Ram';
  }

  // model = first token, trim = remainder
  if (rest) {
    const toks = rest.split(/\s+/);
    row.model = (toks.shift() || '').replace(/^[a-z]/, c => c.toUpperCase());
    row.trim = toks.join(' ');
  }

  // derived spec flags from full title text
  const full = title.toLowerCase();
  if (/high roof/.test(full)) row.roof = 'High';
  else if (/standard roof/.test(full)) row.roof = 'Standard';
  else if (/medium roof/.test(full)) row.roof = 'Medium';
  if (/170"?\s*wb|170 wb|\b170\b/.test(full)) row.wheelbase = '170';
  else if (/144"?\s*wb|144 wb|\b144\b/.test(full)) row.wheelbase = '144';
  if (/4x4|awd|4wd|xdrive|quattro|sdrive/.test(full)) row.drivetrain = '4x4/AWD';
  else if (/\brwd\b/.test(full)) row.drivetrain = 'RWD';

  // numeric helpers for sorting
  row.price_num = row.price ? Number(row.price.replace(/[^\d]/g,'')) : '';
  row.mileage_num = '';
  if (row.mileage) {
    const mm = row.mileage.match(/([\d.]+)(k?)/i);
    if (mm) row.mileage_num = Math.round(parseFloat(mm[1]) * (/k/i.test(mm[2]) ? 1000 : 1));
  }
  return row;
}

const rows = raw.map(parse);

// quick stats
const makeCounts = {};
rows.forEach(r => { makeCounts[r.make || '(unknown)'] = (makeCounts[r.make||'(unknown)']||0)+1; });
const sprinters = rows.filter(r => /sprinter/i.test(r.model) || /sprinter/i.test(r.trim));

fs.writeFileSync('listings_parsed.json', JSON.stringify(rows, null, 2));
console.log('Total rows:', rows.length);
console.log('Sprinter-model rows:', sprinters.length);
console.log('Top makes:', Object.entries(makeCounts).sort((a,b)=>b[1]-a[1]).slice(0,12).map(e=>e[0]+':'+e[1]).join('  '));

// ---- Build XLSX ----
(async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FB Marketplace scrape';
  wb.created = new Date();

  const cols = [
    { header: 'Price', key: 'price_num', width: 12, style: { numFmt: '$#,##0' } },
    { header: 'Orig Price', key: 'orig_num', width: 12, style: { numFmt: '$#,##0' } },
    { header: 'Year', key: 'year', width: 7 },
    { header: 'Make', key: 'make', width: 16 },
    { header: 'Model', key: 'model', width: 14 },
    { header: 'Trim / Details', key: 'trim', width: 40 },
    { header: 'Roof', key: 'roof', width: 9 },
    { header: 'WB', key: 'wheelbase', width: 6 },
    { header: 'Drivetrain', key: 'drivetrain', width: 11 },
    { header: 'Mileage', key: 'mileage_num', width: 11, style: { numFmt: '#,##0' } },
    { header: 'City', key: 'city', width: 16 },
    { header: 'State', key: 'state', width: 7 },
    { header: 'New?', key: 'just_listed', width: 6 },
    { header: 'Dealer?', key: 'dealership', width: 8 },
    { header: 'Link', key: 'url', width: 16 },
  ];

  // Sheet 1: All vehicles
  const all = wb.addWorksheet('All Vehicles', { views: [{ state: 'frozen', ySplit: 1 }] });
  all.columns = cols;
  // Sheet 2: Vans only (Sprinter / Transit / ProMaster)
  const vans = wb.addWorksheet('Vans', { views: [{ state: 'frozen', ySplit: 1 }] });
  vans.columns = cols;

  const isVan = r => /sprinter|transit|promaster|metris|nv\d|e-?series|express/i.test((r.model+' '+r.trim));

  for (const ws of [all, vans]) {
    const src = ws === vans ? rows.filter(isVan) : rows;
    src.forEach(r => {
      const row = ws.addRow({
        ...r,
        orig_num: r.orig_price ? Number(r.orig_price.replace(/[^\d]/g,'')) : null,
      });
      const linkCell = row.getCell('url');
      linkCell.value = { text: 'View', hyperlink: r.url };
      linkCell.font = { color: { argb: 'FF0563C1' }, underline: true };
    });
    // style header
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    h.alignment = { vertical: 'middle' };
    h.height = 20;
    ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
  }

  await wb.xlsx.writeFile('Sprinter_and_Vehicles_Marketplace.xlsx');
  console.log('Wrote Sprinter_and_Vehicles_Marketplace.xlsx  (All:', rows.length, '| Vans:', rows.filter(isVan).length, ')');
})();
