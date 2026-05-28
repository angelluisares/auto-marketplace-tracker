'use client';
import { useState, useRef, useCallback, useEffect } from 'react';

const STATUS_LABEL = {
  scraping: 'Searching Marketplace',
  ingesting: 'Saving results',
  searching: 'Filtering matches',
  done: 'Done',
  error: 'Error',
};

const REGION_OPTS = [
  { v: 'all', label: 'All US (up to 66 metros · very slow)' },
  { v: 'eastern', label: 'Eastern (up to 24)' },
  { v: 'central', label: 'Central (up to 21)' },
  { v: 'mountain', label: 'Mountain (up to 10)' },
  { v: 'pacific', label: 'Pacific (up to 11)' },
];

function fmtMoney(v) { return v != null ? '$' + v.toLocaleString() : ''; }
function fmtNum(v) { return v != null ? v.toLocaleString() : ''; }

export default function SearchPage() {
  const [text, setText] = useState('');
  const [region, setRegion] = useState('eastern');
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const auto = useRef(false);

  useEffect(() => () => clearInterval(timer.current), []);

  const start = useCallback(async (override, regionOverride) => {
    const q = (typeof override === 'string' ? override : text).trim();
    const reg = (typeof regionOverride === 'string' && regionOverride) ? regionOverride : region;
    if (!q || busy) return;
    setText(q);
    if (regionOverride) setRegion(reg);
    setBusy(true);
    setJob({ status: 'scraping', citiesDone: 0, citiesTotal: 0, parsed: null });
    clearInterval(timer.current);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: q, region: reg }),
      });
      const j = await res.json();
      if (!res.ok) { setJob({ status: 'error', error: j.error || 'failed to start' }); setBusy(false); return; }
      setJob(j);
      timer.current = setInterval(async () => {
        const r = await fetch('/api/search?id=' + j.id);
        const cur = await r.json();
        setJob(cur);
        if (cur.status === 'done' || cur.status === 'error') { clearInterval(timer.current); setBusy(false); }
      }, 1500);
    } catch (e) {
      setJob({ status: 'error', error: String(e.message || e) });
      setBusy(false);
    }
  }, [text, region, busy]);

  const onKey = e => { if (e.key === 'Enter') start(); };

  // Auto-run when arriving via /search?q=...&region=... (e.g. "Run now" from Saved Searches)
  useEffect(() => {
    if (auto.current) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) { auto.current = true; start(q, params.get('region') || undefined); }
  }, [start]);

  const p = job?.parsed;
  const pct = job && job.citiesTotal ? Math.round((job.citiesDone / job.citiesTotal) * 100) : 0;
  const rows = job?.results || [];

  return (
    <main>
      <header>
        <h1>Find a Vehicle</h1>
        <a className="back" href="/searches">saved searches →</a>
        <a className="back" href="/metros">metros →</a>
        <a className="back" href="/">browse all →</a>
      </header>

      <div className="searchbar">
        <input
          autoFocus
          placeholder="e.g. camaro zl1 under 25,000 miles"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
        />
        <select value={region} onChange={e => setRegion(e.target.value)} disabled={busy} title="Region to scrape">
          {REGION_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <button onClick={start} disabled={busy || !text.trim()}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      <div className="hint">
        Type a model and (optionally) limits like “under 25,000 miles” or “under $70k”, then pick a region.
        I’ll search Facebook Marketplace across that region’s metros and show the matches. Bigger regions take longer
        (All US ≈ 25 min).
      </div>

      {p && (
        <div className="interp">
          Interpreting as:&nbsp;
          <span className="chip q">{p.query || '(no keywords)'}</span>
          {p.maxMiles != null && <span className="chip">≤ {p.maxMiles.toLocaleString()} mi</span>}
          {p.maxPrice != null && <span className="chip">≤ ${p.maxPrice.toLocaleString()}</span>}
          {p.minYear != null && <span className="chip">{p.minYear}+</span>}
          {p.maxYear != null && <span className="chip">≤ {p.maxYear}</span>}
        </div>
      )}

      {job && job.status !== 'done' && job.status !== 'error' && (
        <div className="status">
          <div className="statusrow">
            <span className="spinner" />
            <strong>{STATUS_LABEL[job.status] || job.status}</strong>
            {job.status === 'scraping' && <span>&nbsp;· {job.citiesDone}/{job.citiesTotal} metros</span>}
          </div>
          <div className="bar"><div className="fill" style={{ width: (job.status === 'scraping' ? pct : 100) + '%' }} /></div>
        </div>
      )}

      {job?.status === 'error' && <div className="error">Error: {job.error}</div>}

      {job?.status === 'done' && (
        <>
          <div className="resulthead">{job.found} match{job.found === 1 ? '' : 'es'} found</div>
          {rows.length === 0
            ? <div className="empty">No matches. Try fewer/looser terms (e.g. drop the mileage cap).</div>
            : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th className="num">Miles</th><th className="num">Price</th><th className="num">Drop</th>
                      <th>Year</th><th>Make</th><th>Model</th><th className="wide">Details</th>
                      <th>City</th><th>ST</th><th>Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id}>
                        <td className="num">{fmtNum(r.mileage_num)}</td>
                        <td className="num">{fmtMoney(r.price_num)}</td>
                        <td className="num drop">{r.price_drop ? '-' + fmtMoney(r.price_drop) : ''}</td>
                        <td>{r.year}</td><td>{r.make}</td><td>{r.model}</td>
                        <td className="wide" title={r.raw_text}>{r.trim}</td>
                        <td>{r.city}</td><td>{r.state}</td>
                        <td><a href={r.url} target="_blank" rel="noreferrer">View</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}

      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; font: 14px/1.4 system-ui, sans-serif; color: #1a1a1a; background: #f5f6f8; }
        main { padding: 18px 22px; max-width: 1200px; margin: 0 auto; }
        header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
        h1 { font-size: 22px; margin: 0; }
        .back { color: #0563c1; font-size: 13px; text-decoration: none; }
        .searchbar { display: flex; gap: 8px; }
        .searchbar input { flex: 1; padding: 12px 14px; border: 1px solid #ccc; border-radius: 8px; font-size: 16px; }
        .searchbar select { padding: 0 10px; border: 1px solid #ccc; border-radius: 8px; font-size: 13px; background: #fff; max-width: 230px; }
        .searchbar button { padding: 12px 22px; border: 0; border-radius: 8px; background: #1f4e78; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
        .searchbar button:disabled { background: #9bb3c9; cursor: default; }
        .hint { color: #666; font-size: 12.5px; margin: 8px 2px 0; }
        .interp { margin: 14px 0 4px; font-size: 13px; color: #444; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
        .chip { background: #e7eef6; border: 1px solid #cdddec; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
        .chip.q { background: #1f4e78; color: #fff; border-color: #1f4e78; font-weight: 600; }
        .status { margin: 16px 0; }
        .statusrow { display: flex; align-items: center; gap: 6px; font-size: 14px; }
        .bar { margin-top: 8px; height: 8px; background: #e3e6ea; border-radius: 6px; overflow: hidden; }
        .fill { height: 100%; background: #1f4e78; transition: width .4s ease; }
        .spinner { width: 14px; height: 14px; border: 2px solid #c3d2e0; border-top-color: #1f4e78; border-radius: 50%; display: inline-block; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .error { margin: 16px 0; color: #b00; }
        .resulthead { margin: 18px 0 8px; font-size: 15px; font-weight: 600; }
        .empty { color: #666; padding: 14px 0; }
        .tablewrap { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: auto; max-height: calc(100vh - 280px); }
        table { border-collapse: collapse; width: 100%; font-size: 13px; }
        thead th { position: sticky; top: 0; background: #1f4e78; color: #fff; padding: 8px 10px; text-align: left; white-space: nowrap; }
        thead th.num { text-align: right; }
        tbody td { padding: 6px 10px; border-top: 1px solid #eee; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
        tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
        tbody td.drop { color: #008000; font-weight: 600; }
        tbody tr:hover { background: #f0f6ff; }
        a { color: #0563c1; }
      `}</style>
    </main>
  );
}
