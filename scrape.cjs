// Standalone Playwright scraper for logged-out FB Marketplace vehicle listings.
// Drives a real (headed) Chrome from the command line — no extension, no prompts.
//
// Usage:
//   node scrape.cjs <city> [city ...]                 # default category: vehicles
//   node scrape.cjs --query "cargo van" <city> ...    # keyword search instead of category
//
// Writes sweep_batches/<city>_<cat>.json = [{ id, text }]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
let query = null;
const cities = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--query') { query = args[++i]; }
  else cities.push(args[i]);
}
if (!cities.length) { console.error('usage: node scrape.cjs [--query "term"] <city> [city ...]'); process.exit(1); }

const OUT_DIR = path.join(__dirname, 'sweep_batches');
const PROFILE = path.join(__dirname, '.pw-profile');
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dismissModal(page) {
  try {
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => {
      // 1) click any "Close" control inside a dialog
      document.querySelectorAll('[role="dialog"] [aria-label]').forEach(el => {
        if ((el.getAttribute('aria-label') || '').toLowerCase().includes('close')) {
          try { el.click(); } catch {}
        }
      });
      // 2) if it's the login/"See more on Facebook" wall, remove it outright
      document.querySelectorAll('[role="dialog"]').forEach(d => {
        const t = (d.innerText || '').toLowerCase();
        if (t.includes('see more on facebook') || t.includes('log in') || t.includes('create new account')) {
          try { d.remove(); } catch {}
        }
      });
      // 3) FB locks page scroll while the modal is up — restore it
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.position = '';
      // 4) drop a leftover fixed full-screen backdrop (mostly-empty top-layer div)
      document.querySelectorAll('body > div').forEach(el => {
        const s = getComputedStyle(el);
        if (s.position === 'fixed' && parseInt(s.zIndex || '0', 10) >= 100 &&
            el.getBoundingClientRect().height > window.innerHeight * 0.9 &&
            !el.querySelector('a[href*="/marketplace/item/"]')) {
          try { el.remove(); } catch {}
        }
      });
    }).catch(() => {});
  } catch {}
}

async function scrapeCity(page, city) {
  const url = query
    ? `https://www.facebook.com/marketplace/${city}/search?query=${encodeURIComponent(query)}`
    : `https://www.facebook.com/marketplace/${city}/vehicles`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  await dismissModal(page);
  await sleep(1000);

  let last = -1, stable = 0;
  for (let i = 0; i < 30 && stable < 4; i++) {
    await dismissModal(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(1800);
    const n = await page.evaluate(() => document.querySelectorAll('a[href*="/marketplace/item/"]').length);
    if (n === last) stable++; else { stable = 0; last = n; }
  }

  return page.evaluate(() => {
    const seen = {}, records = [];
    document.querySelectorAll('a[href*="/marketplace/item/"]').forEach(a => {
      const m = a.getAttribute('href').match(/item\/(\d+)/);
      if (!m) return;
      const id = m[1];
      if (seen[id]) return; seen[id] = 1;
      const text = a.innerText.replace(/\n+/g, ' | ').trim();
      if (text) records.push({ id, text });
    });
    return { records, title: document.title, bodyStart: document.body.innerText.slice(0, 80) };
  });
}

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const cat = query ? query.replace(/\s+/g, '_') : 'vehicles';
  for (const city of cities) {
    try {
      const { records, title, bodyStart } = await scrapeCity(page, city);
      const out = path.join(OUT_DIR, `${city}_${cat}.json`);
      fs.writeFileSync(out, JSON.stringify(records));
      console.log(`${city}: ${records.length} records -> ${path.basename(out)} | title: ${title.slice(0, 64)}`);
      if (!records.length) console.log(`   (0 records; page text starts: "${bodyStart.replace(/\n/g, ' ')}")`);
    } catch (e) {
      console.error(`${city}: FAILED - ${e.message}`);
    }
    await sleep(2500);
  }
  await ctx.close();
  console.log('done.');
})();
