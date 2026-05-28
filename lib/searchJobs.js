// In-memory search jobs: parse text -> scrape the city grid for the query ->
// ingest into Postgres -> return matching listings. Used by /api/search.
//
// Jobs live in memory (single dev-server process). status flow:
//   scraping -> ingesting -> searching -> done   (or: error)
import { spawn } from 'node:child_process';
import path from 'node:path';
import sp from './searchParse.js';
import grid from './grid.cjs';
import store from './searchStore.js';

const { parseSearch } = sp;

const ROOT = process.cwd();

// Metro grid shared with the scheduler (lib/grid.cjs).
export const CITIES = grid.CITIES;

const jobs = new Map();
let seq = 1;

export function getJob(id) { return jobs.get(id) || null; }

export function createAndRun(text) {
  const parsed = parseSearch(text);
  const id = String(seq++);
  const job = {
    id, text, parsed,
    status: parsed.query ? 'scraping' : 'searching',
    citiesTotal: CITIES.length, citiesDone: 0,
    found: null, results: null, error: null,
    startedAt: Date.now(), finishedAt: null,
  };
  jobs.set(id, job);
  run(job).catch(e => {
    job.status = 'error';
    job.error = String((e && e.message) || e);
    job.finishedAt = Date.now();
  });
  return job;
}

function spawnNode(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: ROOT });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

async function run(job) {
  const q = job.parsed.query;
  if (q) {
    const cat = q.replace(/\s+/g, '_');
    // 1) scrape — track progress from scrape.cjs stdout (one line per city)
    await new Promise(resolve => {
      const child = spawn(process.execPath, ['scrape.cjs', '--query', q, ...CITIES], { cwd: ROOT });
      let buf = '';
      child.stdout.on('data', d => {
        buf += d.toString();
        const lines = buf.split('\n'); buf = lines.pop();
        for (const ln of lines) if (/records ->|FAILED/.test(ln)) job.citiesDone++;
      });
      child.stderr.on('data', () => {});
      child.on('close', () => resolve());
      child.on('error', () => resolve());
    });
    // 2) ingest each city's batch into the shared DB (UPSERT)
    job.status = 'ingesting';
    for (const city of CITIES) {
      await spawnNode(['marketplace_tracker.cjs', 'ingest', path.join('sweep_batches', `${city}_${cat}.json`)]);
    }
  }
  // 3) query the DB for matches
  job.status = 'searching';
  await finish(job);
}

async function finish(job) {
  job.results = await store.matchListings(job.parsed);
  job.found = job.results.length;
  job.status = 'done';
  job.finishedAt = Date.now();
  try { await store.recordRun(job.parsed, job.found); } catch { /* history is best-effort */ }
}
