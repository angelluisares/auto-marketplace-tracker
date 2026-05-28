// Pure parsing helpers shared by the ingest pipeline. No DB dependencies.
const crypto = require('crypto');

const MAKES = [
  'Mercedes-Benz','Mercedes','Freightliner','Dodge','Ford','Ram','Nissan','Chevrolet','GMC',
  'BMW','Audi','Porsche','Lexus','Land Rover','Toyota','Volkswagen','Honda','Mini','MINI',
  'Ducati','Kawasaki','Yamaha','Husqvarna','KTM','Harley-Davidson','Moto Guzzi','Suzuki','Surron','Sur-Ron','Talaria','Segway',
  'Winnebago','Thor Motor Coach','Jayco','Entegra Coach','Forest River','Keystone','Tiffin Motorhomes','Gulf Stream','Dynamax','Itasca','inTech RV','inTech','Intech','Storyteller Overland','Air Opus','Airstream',
  'Sea Ray','Sea Doo','Sea-Doo','SeaDoo','Seadoo','Malibu','Nautique','Cobalt','Bayliner','Stingray','Scarab','Formula','Aviara','Chris Craft','Moomba','Stratus',
  'Mahindra','Vanderhall','Polaris','Can-Am','Rivian','Lotus','International','Oshkosh','Isuzu','Cushman','Club Car','EZGO','Evolution','MOKE','Daihatsu','Mitsubishi','Acura','Hummer','Cannondale','John Deere','Bombardier','NIU','Alta Motors','BrightDrop','Volvo','Jeep','Kia','Hyundai'
].sort((a, b) => b.length - a.length);

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
  row.hash = crypto.createHash('sha1')
    .update([row.price_num, row.year, row.make, row.model, row.trim, row.mileage_num, row.city, row.state].join('¦'))
    .digest('hex').slice(0, 12);
  if (listedDate) row.listed_date = listedDate;
  return row;
}

// Classification helpers (shared by web app and exports)
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

module.exports = { MAKES, resolveListedDate, parseListing, isVan, isJunk };
