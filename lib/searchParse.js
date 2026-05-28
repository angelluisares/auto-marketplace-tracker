// Turn a free-text vehicle search into a marketplace query + numeric filters.
//
//   "camaro zl1 under 25,000 miles below $70k"
//     -> { query: "camaro zl1", maxMiles: 25000, maxPrice: 70000, minYear: null, maxYear: null }
//
// The `query` is what we send to Facebook search; the numeric bits are applied
// afterward against our own parsed data (mileage_num / price_num / year).

function toNumber(s) {
  if (!s) return null;
  s = String(s).toLowerCase().replace(/[,\s$]/g, '');
  let mult = 1;
  if (s.endsWith('k')) { mult = 1000; s = s.slice(0, -1); }
  else if (s.endsWith('m')) { mult = 1000000; s = s.slice(0, -1); }
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : Math.round(n * mult);
}

const NUM = '\\$?\\d[\\d.,]*\\s*[km]?';

function parseSearch(text) {
  const raw = (text || '').trim();
  const s = ' ' + raw.toLowerCase() + ' ';
  let maxMiles = null, maxPrice = null, minYear = null, maxYear = null;

  // --- mileage ---
  let m = s.match(new RegExp(`(?:under|below|less than|max|<=?|up to)\\s*(${NUM})\\s*(?:miles|mile|mi)\\b`));
  if (m) maxMiles = toNumber(m[1]);
  if (maxMiles == null) {
    m = s.match(new RegExp(`(${NUM})\\s*(?:miles|mile|mi)\\s*(?:or less|or fewer|or under|max)`));
    if (m) maxMiles = toNumber(m[1]);
  }

  // --- price --- (require a $ or the words dollars/price to avoid eating mileage numbers)
  m = s.match(new RegExp(`(?:under|below|less than|max|<=?|up to|cheaper than)\\s*\\$\\s*(\\d[\\d.,]*\\s*[km]?)`));
  if (m) maxPrice = toNumber(m[1]);
  if (maxPrice == null) {
    m = s.match(new RegExp(`(?:under|below|less than|max|up to)\\s*(\\d[\\d.,]*\\s*[km]?)\\s*(?:dollars|usd|bucks)`));
    if (m) maxPrice = toNumber(m[1]);
  }

  // --- absolute year ---
  m = s.match(/(?:after|newer than|since|from|>=?)\s*((?:19|20)\d{2})/);
  if (m) minYear = parseInt(m[1], 10);
  m = s.match(/(?:before|older than|<=?)\s*((?:19|20)\d{2})/);
  if (m) maxYear = parseInt(m[1], 10);

  // --- relative age ("5 years old", "less than 5 years", "last 3 years") ---
  const thisYear = new Date().getFullYear();
  m = s.match(/(?:less than|under|within|past|last|newer than)\s*(\d{1,2})\s*(?:year|yr)s?(?:\s*old)?/);
  if (m && minYear == null) minYear = thisYear - parseInt(m[1], 10);
  m = s.match(/(?:more than|older than|over)\s*(\d{1,2})\s*(?:year|yr)s?(?:\s*old)?/);
  if (m && maxYear == null) maxYear = thisYear - parseInt(m[1], 10);

  // --- build the marketplace query by stripping the filter phrases out of the raw text ---
  let q = raw;
  q = q.replace(new RegExp(`(?:under|below|less than|max|<=?|up to)\\s*(${NUM})\\s*(?:miles|mile|mi)\\b`, 'gi'), ' ');
  q = q.replace(new RegExp(`(${NUM})\\s*(?:miles|mile|mi)\\s*(?:or less|or fewer|or under|max)`, 'gi'), ' ');
  q = q.replace(new RegExp(`(?:under|below|less than|max|<=?|up to|cheaper than)\\s*\\$\\s*(\\d[\\d.,]*\\s*[km]?)`, 'gi'), ' ');
  q = q.replace(new RegExp(`(?:under|below|less than|max|up to)\\s*(\\d[\\d.,]*\\s*[km]?)\\s*(?:dollars|usd|bucks)`, 'gi'), ' ');
  q = q.replace(/(?:after|newer than|since|from|before|older than|>=?|<=?)\s*(?:19|20)\d{2}/gi, ' ');
  // relative-age phrases
  q = q.replace(/(?:less than|under|within|past|last|newer than|more than|older than|over)\s*\d{1,2}\s*(?:year|yr)s?(?:\s*old)?/gi, ' ');
  // remove leftover comparison/filler words so they aren't treated as required keywords
  q = q.replace(/\b(?:miles|mile|mi|years|year|yr|old|less|than|more|fewer|newer|older|over|under|below|within|past|low|high|max|min|or|and|with|priced|listed|near|around|that|has)\b/gi, ' ');
  q = q.replace(/[<>]=?/g, ' ');
  q = q.replace(/\s+/g, ' ').trim();

  return { query: q, maxMiles, maxPrice, minYear, maxYear, raw };
}

module.exports = { parseSearch };
