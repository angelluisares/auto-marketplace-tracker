// Tiny local collector: receives scrape batches from the browser (via fetch POST)
// and writes them to disk. Sidesteps Chrome's download mechanism entirely.
//
//   node collector_server.cjs           # listens on http://127.0.0.1:8787
//   POST /append  body: {"records":[{id,text,listed_rel?}, ...], "source":"greenville/sprinter van"}
//        -> appends into sweep_accumulator.json (deduped by id)
//   POST /reset                          # clears the accumulator (start a fresh sweep)
//   GET  /status                         # { count, sources }

const http = require('http');
const fs = require('fs');

const ACC = 'sweep_accumulator.json';
const PORT = 8787;

function load() { try { return JSON.parse(fs.readFileSync(ACC, 'utf8')); } catch { return { records: {}, sources: [] }; } }
function save(s) { fs.writeFileSync(ACC, JSON.stringify(s)); }

const server = http.createServer((req, res) => {
  // CORS so facebook.com page can POST here
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url === '/status') {
    const s = load();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ count: Object.keys(s.records).length, sources: s.sources }));
  }
  if (req.method === 'POST' && req.url === '/reset') {
    save({ records: {}, sources: [] });
    res.writeHead(200); return res.end('reset');
  }
  if (req.method === 'POST' && req.url === '/append') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { records, source } = JSON.parse(body);
        const s = load();
        let added = 0;
        for (const r of (records || [])) {
          if (!r.id || !r.text) continue;
          if (!s.records[r.id]) added++;
          // keep first listed_rel we see; always keep latest text
          s.records[r.id] = { id: r.id, text: r.text, listed_rel: r.listed_rel || s.records[r.id]?.listed_rel || null };
        }
        if (source) s.sources.push({ source, at: new Date().toISOString(), got: (records||[]).length, newUnique: added });
        save(s);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, totalUnique: Object.keys(s.records).length, added }));
      } catch (e) {
        res.writeHead(400); res.end('err: ' + e.message);
      }
    });
    return;
  }
  res.writeHead(404); res.end('nope');
});

server.listen(PORT, '127.0.0.1', () => console.log(`collector listening on http://127.0.0.1:${PORT}`));
