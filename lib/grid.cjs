// Shared metro grid used by both the live search (ESM) and the scheduler (CJS).
// Logged-out FB caps ~40 results/city, so breadth is how rare models surface.
// Slugs verified to resolve to the intended US city.
const CITIES = [
  'atlanta', 'charlotte', 'nashville', 'raleigh', 'charleston', 'greenville',
  'knoxville', 'augusta', 'dallas', 'houston', 'miami', 'orlando',
];
module.exports = { CITIES };
