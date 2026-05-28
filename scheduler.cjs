// Scheduled-search worker. Run alongside the app:  node scheduler.cjs
//
// Every 60s it finds scheduled searches whose next_run_at is due, re-scrapes the
// metro grid for each, ingests, recomputes matches, and reschedules (recordRun
// stamps the next run from the interval). Keep it running in its own terminal.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { CITIES } = require('./lib/grid.cjs');
const store = require('./lib/searchStore.js');

const ROOT = __dirname;
const TICK_MS = 60 * 1000;

function spawnNode(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: ROOT });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

async function runSearch(row) {
  const log = m => console.log(`[${new Date().toISOString()}] ${m}`);
  const q = row.query;
  if (q) {
    const cat = q.replace(/\s+/g, '_');
    log(`scraping "${row.text}" (${q}) across ${CITIES.length} metros…`);
    await spawnNode(['scrape.cjs', '--query', q, ...CITIES]);
    for (const city of CITIES) {
      await spawnNode(['marketplace_tracker.cjs', 'ingest', path.join('sweep_batches', `${city}_${cat}.json`)]);
    }
  }
  const parsed = store.rowToParsed(row);
  const matches = await store.matchListings(parsed);
  await store.recordRun(parsed, matches.length); // updates last_run_at, last_found, next_run_at
  log(`done "${row.text}" -> ${matches.length} matches`);
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const due = await store.dueSearches();
    if (due.length) console.log(`[${new Date().toISOString()}] ${due.length} due search(es)`);
    for (const row of due) {
      try { await runSearch(row); }
      catch (e) { console.error(`run failed for "${row.text}":`, e.message); }
    }
  } catch (e) {
    console.error('tick error:', e.message);
  } finally {
    running = false;
  }
}

console.log(`[${new Date().toISOString()}] scheduler started — checking every ${TICK_MS / 1000}s. Cities: ${CITIES.length}`);
tick();
setInterval(tick, TICK_MS);
