'use client';
import { useState, useEffect, useCallback } from 'react';

const INTERVALS = [
  { v: 0, label: 'Not scheduled' },
  { v: 360, label: 'Every 6 hours' },
  { v: 720, label: 'Every 12 hours' },
  { v: 1440, label: 'Daily' },
  { v: 4320, label: 'Every 3 days' },
  { v: 10080, label: 'Weekly' },
];

function ago(ts) {
  if (!ts) return '—';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  const fut = d < 0; const s = Math.abs(d);
  const m = Math.round(s / 60), h = Math.round(s / 3600), dy = Math.round(s / 86400);
  let out;
  if (s < 90) out = 'just now';
  else if (m < 90) out = `${m}m`;
  else if (h < 36) out = `${h}h`;
  else out = `${dy}d`;
  if (out === 'just now') return out;
  return fut ? `in ${out}` : `${out} ago`;
}

function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function chips(s) {
  const c = [];
  if (s.max_miles != null) c.push(`≤ ${s.max_miles.toLocaleString()} mi`);
  if (s.max_price != null) c.push(`≤ $${s.max_price.toLocaleString()}`);
  if (s.min_year != null) c.push(`${s.min_year}+`);
  if (s.max_year != null) c.push(`≤ ${s.max_year}`);
  return c;
}

export default function SearchesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [results, setResults] = useState({ id: null, rows: [], loading: false });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/searches');
    const j = await r.json();
    setRows(j.searches || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setInterval_ = async (id, v) => {
    const body = { id, scheduled: v > 0, intervalMinutes: v > 0 ? v : null };
    const r = await fetch('/api/searches', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.search) setRows(rs => rs.map(x => x.id === id ? j.search : x));
  };

  const del = async (id) => {
    await fetch('/api/searches?id=' + id, { method: 'DELETE' });
    setRows(rs => rs.filter(x => x.id !== id));
    if (expanded === id) setExpanded(null);
  };

  const view = async (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id); setResults({ id, rows: [], loading: true });
    const r = await fetch('/api/searches?results=' + id);
    const j = await r.json();
    setResults({ id, rows: j.results || [], loading: false });
  };

  return (
    <main>
      <header>
        <h1>Saved Searches</h1>
        <a className="link" href="/search">+ new search</a>
        <a className="link" href="/">browse all →</a>
      </header>

      {loading ? <div className="muted">Loading…</div>
        : rows.length === 0 ? <div className="muted">No searches yet. Run one on the <a href="/search">search page</a> and it’ll show up here.</div>
        : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Search</th><th>Last run</th><th className="num">Took</th><th className="num">Found</th><th className="num">Runs</th>
                  <th>Schedule</th><th>Next run</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <>
                    <tr key={s.id} className={s.scheduled ? 'sched' : ''}>
                      <td>
                        <div className="q">{s.query || s.text}</div>
                        <div className="chiprow">
                          {s.region && <span className="chip region">{s.region === 'all' ? 'All US' : s.region}</span>}
                          {chips(s).map((c, i) => <span key={i} className="chip">{c}</span>)}
                        </div>
                      </td>
                      <td>{ago(s.last_run_at)}</td>
                      <td className="num">{fmtDur(s.last_duration_ms)}</td>
                      <td className="num">{s.last_found ?? '—'}</td>
                      <td className="num">{s.run_count}</td>
                      <td>
                        <select value={s.scheduled ? (s.interval_minutes || 0) : 0} onChange={e => setInterval_(s.id, Number(e.target.value))}>
                          {INTERVALS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                        </select>
                      </td>
                      <td>{s.scheduled ? ago(s.next_run_at) : '—'}</td>
                      <td className="actions">
                        <button onClick={() => view(s.id)}>{expanded === s.id ? 'Hide' : 'View'}</button>
                        <a href={'/search?q=' + encodeURIComponent(s.text) + (s.region ? '&region=' + s.region : '')}>Run now</a>
                        <button className="del" onClick={() => del(s.id)}>Delete</button>
                      </td>
                    </tr>
                    {expanded === s.id && (
                      <tr className="exp">
                        <td colSpan={8}>
                          {results.loading ? <div className="muted">Loading matches…</div>
                            : results.rows.length === 0 ? <div className="muted">No current matches in the DB for this search.</div>
                            : (
                              <table className="inner">
                                <thead><tr><th className="num">Miles</th><th className="num">Price</th><th className="num">Drop</th><th>Year</th><th>Make</th><th>Model</th><th className="wide">Details</th><th>City</th><th>ST</th><th>Link</th></tr></thead>
                                <tbody>
                                  {results.rows.map(r => (
                                    <tr key={r.id}>
                                      <td className="num">{r.mileage_num != null ? r.mileage_num.toLocaleString() : ''}</td>
                                      <td className="num">{r.price_num != null ? '$' + r.price_num.toLocaleString() : ''}</td>
                                      <td className="num drop">{r.price_drop ? '-$' + r.price_drop.toLocaleString() : ''}</td>
                                      <td>{r.year}</td><td>{r.make}</td><td>{r.model}</td>
                                      <td className="wide" title={r.raw_text}>{r.trim}</td>
                                      <td>{r.city}</td><td>{r.state}</td>
                                      <td><a href={r.url} target="_blank" rel="noreferrer">View</a></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <p className="note">
        Scheduled searches re-run automatically when the <code>scheduler.cjs</code> worker is running
        (<code>node scheduler.cjs</code>). Each run re-scrapes the metro grid and updates matches &amp; price history.
      </p>

      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; font: 14px/1.4 system-ui, sans-serif; color: #1a1a1a; background: #f5f6f8; }
        main { padding: 18px 22px; max-width: 1200px; margin: 0 auto; }
        header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
        h1 { font-size: 22px; margin: 0; }
        .link { color: #0563c1; font-size: 13px; text-decoration: none; }
        .muted { color: #666; padding: 12px 0; }
        .tablewrap { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: auto; }
        table { border-collapse: collapse; width: 100%; font-size: 13px; }
        thead th { background: #1f4e78; color: #fff; padding: 8px 10px; text-align: left; white-space: nowrap; }
        thead th.num { text-align: right; }
        tbody td { padding: 8px 10px; border-top: 1px solid #eee; vertical-align: top; }
        tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
        tr.sched { background: #f1f8f1; }
        .q { font-weight: 600; }
        .chiprow { margin-top: 3px; display: flex; gap: 4px; flex-wrap: wrap; }
        .chip { background: #e7eef6; border: 1px solid #cdddec; border-radius: 999px; padding: 1px 8px; font-size: 11px; }
        .chip.region { background: #eaf3ea; border-color: #cfe3cf; color: #2c6e2c; text-transform: capitalize; }
        select { padding: 5px 6px; border: 1px solid #ccc; border-radius: 6px; font-size: 12px; }
        .actions { white-space: nowrap; }
        .actions button, .actions a { margin-right: 8px; font-size: 12px; cursor: pointer; background: none; border: 0; color: #0563c1; padding: 0; text-decoration: none; }
        .actions .del { color: #b00; }
        tr.exp td { background: #fafbfc; }
        table.inner { border: 1px solid #e6e6e6; border-radius: 6px; margin: 2px 0; }
        table.inner thead th { background: #41618a; }
        td.drop { color: #008000; font-weight: 600; }
        .wide { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .note { color: #777; font-size: 12px; margin-top: 14px; }
        code { background: #eef0f2; padding: 1px 5px; border-radius: 4px; }
        a { color: #0563c1; }
      `}</style>
    </main>
  );
}
