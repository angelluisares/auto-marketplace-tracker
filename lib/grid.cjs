// CATALOG of validated metros: { slug, region, label }. Every slug was loaded and
// confirmed to resolve to the intended US city. NOTE: Facebook only exposes name
// slugs for MAJOR metros — mid-size cities (Sacramento, Long Beach, Boulder, OKC…)
// return a generic page and would need FB numeric location IDs (future work). That's
// why Mountain/Pacific are smaller here.
const CATALOG = [
  // ---- Eastern (24) ----
  { slug: 'nyc', region: 'eastern', label: 'New York, NY' },
  { slug: 'boston', region: 'eastern', label: 'Boston, MA' },
  { slug: 'philly', region: 'eastern', label: 'Philadelphia, PA' },
  { slug: 'dc', region: 'eastern', label: 'Washington, DC' },
  { slug: 'baltimore', region: 'eastern', label: 'Baltimore, MD' },
  { slug: 'pittsburgh', region: 'eastern', label: 'Pittsburgh, PA' },
  { slug: 'buffalo', region: 'eastern', label: 'Buffalo, NY' },
  { slug: 'richmond', region: 'eastern', label: 'Richmond, VA' },
  { slug: 'virginiabeach', region: 'eastern', label: 'Virginia Beach, VA' },
  { slug: 'detroit', region: 'eastern', label: 'Detroit, MI' },
  { slug: 'columbus', region: 'eastern', label: 'Columbus, OH' },
  { slug: 'cleveland', region: 'eastern', label: 'Cleveland, OH' },
  { slug: 'cincinnati', region: 'eastern', label: 'Cincinnati, OH' },
  { slug: 'indianapolis', region: 'eastern', label: 'Indianapolis, IN' },
  { slug: 'louisville', region: 'eastern', label: 'Louisville, KY' },
  { slug: 'knoxville', region: 'eastern', label: 'Knoxville, TN' },
  { slug: 'atlanta', region: 'eastern', label: 'Atlanta, GA' },
  { slug: 'charlotte', region: 'eastern', label: 'Charlotte, NC' },
  { slug: 'raleigh', region: 'eastern', label: 'Raleigh, NC' },
  { slug: 'charleston', region: 'eastern', label: 'Charleston, SC' },
  { slug: 'jacksonville', region: 'eastern', label: 'Jacksonville, FL' },
  { slug: 'miami', region: 'eastern', label: 'Miami, FL' },
  { slug: 'orlando', region: 'eastern', label: 'Orlando, FL' },
  { slug: 'tampa', region: 'eastern', label: 'Tampa, FL' },

  // ---- Central (21) ----
  { slug: 'chicago', region: 'central', label: 'Chicago, IL' },
  { slug: 'milwaukee', region: 'central', label: 'Milwaukee, WI' },
  { slug: 'madison', region: 'central', label: 'Madison, WI' },
  { slug: 'minneapolis', region: 'central', label: 'Minneapolis, MN' },
  { slug: 'desmoines', region: 'central', label: 'Des Moines, IA' },
  { slug: 'omaha', region: 'central', label: 'Omaha, NE' },
  { slug: 'wichita', region: 'central', label: 'Wichita, KS' },
  { slug: 'kansascity', region: 'central', label: 'Kansas City, MO' },
  { slug: 'stlouis', region: 'central', label: 'St. Louis, MO' },
  { slug: 'tulsa', region: 'central', label: 'Tulsa, OK' },
  { slug: 'littlerock', region: 'central', label: 'Little Rock, AR' },
  { slug: 'dallas', region: 'central', label: 'Dallas, TX' },
  { slug: 'fortworth', region: 'central', label: 'Fort Worth, TX' },
  { slug: 'houston', region: 'central', label: 'Houston, TX' },
  { slug: 'austin', region: 'central', label: 'Austin, TX' },
  { slug: 'sanantonio', region: 'central', label: 'San Antonio, TX' },
  { slug: 'neworleans', region: 'central', label: 'New Orleans, LA' },
  { slug: 'batonrouge', region: 'central', label: 'Baton Rouge, LA' },
  { slug: 'memphis', region: 'central', label: 'Memphis, TN' },
  { slug: 'nashville', region: 'central', label: 'Nashville, TN' },
  { slug: 'huntsville', region: 'central', label: 'Huntsville, AL' },

  // ---- Mountain (10) ----
  { slug: 'denver', region: 'mountain', label: 'Denver, CO' },
  { slug: 'coloradosprings', region: 'mountain', label: 'Colorado Springs, CO' },
  { slug: 'saltlakecity', region: 'mountain', label: 'Salt Lake City, UT' },
  { slug: 'ogden', region: 'mountain', label: 'Ogden, UT' },
  { slug: 'boise', region: 'mountain', label: 'Boise, ID' },
  { slug: 'albuquerque', region: 'mountain', label: 'Albuquerque, NM' },
  { slug: 'elpaso', region: 'mountain', label: 'El Paso, TX' },
  { slug: 'phoenix', region: 'mountain', label: 'Phoenix, AZ' },
  { slug: 'mesa', region: 'mountain', label: 'Mesa, AZ' },
  { slug: 'tucson', region: 'mountain', label: 'Tucson, AZ' },

  // ---- Pacific (11) ----
  { slug: 'seattle', region: 'pacific', label: 'Seattle, WA' },
  { slug: 'spokane', region: 'pacific', label: 'Spokane, WA' },
  { slug: 'portland', region: 'pacific', label: 'Portland, OR' },
  { slug: 'reno', region: 'pacific', label: 'Reno, NV' },
  { slug: 'vegas', region: 'pacific', label: 'Las Vegas, NV' },
  { slug: 'sanfrancisco', region: 'pacific', label: 'San Francisco, CA' },
  { slug: 'oakland', region: 'pacific', label: 'Oakland, CA' },
  { slug: 'sanjose', region: 'pacific', label: 'San Jose, CA' },
  { slug: 'fresno', region: 'pacific', label: 'Fresno, CA' },
  { slug: 'la', region: 'pacific', label: 'Los Angeles, CA' },
  { slug: 'sandiego', region: 'pacific', label: 'San Diego, CA' },
];

const REGION_ORDER = ['eastern', 'central', 'mountain', 'pacific'];
const REGION_LABELS = { all: 'All US', eastern: 'Eastern', central: 'Central', mountain: 'Mountain', pacific: 'Pacific' };

const ALL = CATALOG.map(m => m.slug);
const REGIONS = REGION_ORDER.reduce((acc, r) => {
  acc[r] = CATALOG.filter(m => m.region === r).map(m => m.slug);
  return acc;
}, {});

// Static catalog lookup (the DB-backed enabled set lives in lib/metroStore.js).
function citiesFor(region) {
  if (!region || region === 'all') return ALL;
  return REGIONS[region] || ALL;
}
function isRegion(r) { return r === 'all' || REGION_ORDER.includes(r); }
function labelFor(slug) { const m = CATALOG.find(x => x.slug === slug); return m ? m.label : slug; }

module.exports = {
  CATALOG, REGIONS, REGION_ORDER, REGION_LABELS, ALL,
  citiesFor, isRegion, labelFor,
  CITIES: ALL, // back-compat
};
