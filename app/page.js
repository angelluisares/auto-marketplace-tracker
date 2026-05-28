'use client';
import { useEffect, useState, useCallback } from 'react';

const COLS = [
  { key: 'price_num', label: 'Price', fmt: v => v != null ? '$' + v.toLocaleString() : '', num: true },
  { key: 'price_drop', label: 'Drop', fmt: v => v ? '-$' + v.toLocaleString() : '', num: true, cls: 'drop' },
  { key: 'year', label: 'Year', num: true },
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'trim', label: 'Trim / Details', wide: true },
  { key: 'mileage_num', label: 'Miles', fmt: v => v != null ? v.toLocaleString() : '', num: true },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'ST' },
  { key: 'listed_date', label: 'Listed (FB)' },
  { key: 'first_seen', label: 'First Seen', fmt: v => (v || '').slice(0, 10) },
  { key: 'times_seen', label: 'Seen', num: true },
];

export default function Page() {
  const [data, setData] = useState({ rows: [], count: 0, facets: { makes: [], states: [], total: {} } });
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({
    q: '', make: '', state: '', vansOnly: false, hideJunk: true, activeOnly: false,
    minPrice: '', maxPrice: '', maxMileage: '', sort: 'last_seen', dir: 'desc',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => {
      if (v === '' || v == null) return;
      p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
    });
    const res = await fetch('/api/listings?' + p.toString());
    setData(await res.json());
    setLoading(false);
  }, [f]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const sortBy = (key) => setF(s => ({ ...s, sort: key, dir: s.sort === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <main>
      <header>
        <h1>Auto Marketplace Tracker</h1>
        <span className="meta">
          {data.facets.total?.n ?? 0} tracked · {data.facets.total?.active ?? 0} active · showing {data.count}
        </span>
        <a className="findlink" href="/search">🔎 Find a vehicle…</a>
        <a className="savedlink" href="/searches">Saved searches</a>
      </header>

      <div className="filters">
        <input placeholder="Search title…" value={f.q} onChange={e => set('q', e.target.value)} />
        <select value={f.make} onChange={e => set('make', e.target.value)}>
          <option value="">All makes</option>
          {data.facets.makes.map(m => <option key={m.make} value={m.make}>{m.make} ({m.n})</option>)}
        </select>
        <select value={f.state} onChange={e => set('state', e.target.value)}>
          <option value="">All states</option>
          {data.facets.states.map(s => <option key={s.state} value={s.state}>{s.state} ({s.n})</option>)}
        </select>
        <input type="number" placeholder="Min $" value={f.minPrice} onChange={e => set('minPrice', e.target.value)} style={{ width: 80 }} />
        <input type="number" placeholder="Max $" value={f.maxPrice} onChange={e => set('maxPrice', e.target.value)} style={{ width: 90 }} />
        <input type="number" placeholder="Max miles" value={f.maxMileage} onChange={e => set('maxMileage', e.target.value)} style={{ width: 100 }} />
        <label><input type="checkbox" checked={f.vansOnly} onChange={e => set('vansOnly', e.target.checked)} /> Vans only</label>
        <label><input type="checkbox" checked={f.hideJunk} onChange={e => set('hideJunk', e.target.checked)} /> Hide junk</label>
        <label><input type="checkbox" checked={f.activeOnly} onChange={e => set('activeOnly', e.target.checked)} /> Active only</label>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {COLS.map(c => (
                <th key={c.key} onClick={() => sortBy(c.key)} className={c.num ? 'num' : ''}>
                  {c.label}{f.sort === c.key ? (f.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.id} className={r.junk ? 'junkrow' : ''}>
                {COLS.map(c => (
                  <td key={c.key} className={`${c.num ? 'num' : ''} ${c.cls || ''}`} title={c.key === 'trim' ? r.trim : ''}>
                    {c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? '')}
                  </td>
                ))}
                <td><a href={r.url} target="_blank" rel="noreferrer">View</a></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="loading">Loading…</div>}
        {!loading && data.rows.length === 0 && <div className="loading">No listings match these filters.</div>}
      </div>

      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; font: 14px/1.4 system-ui, sans-serif; color: #1a1a1a; background: #f5f6f8; }
        main { padding: 16px 20px; }
        header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 12px; }
        h1 { font-size: 20px; margin: 0; }
        .meta { color: #666; font-size: 13px; }
        .findlink { margin-left: auto; color: #fff; background: #1f4e78; padding: 6px 12px; border-radius: 6px; font-size: 13px; text-decoration: none; font-weight: 600; }
        .savedlink { color: #1f4e78; font-size: 13px; text-decoration: none; font-weight: 600; }
        .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
        .filters input, .filters select { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
        .filters label { font-size: 13px; color: #333; display: flex; align-items: center; gap: 4px; cursor: pointer; }
        .tablewrap { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: auto; max-height: calc(100vh - 130px); position: relative; }
        table { border-collapse: collapse; width: 100%; font-size: 13px; }
        thead th { position: sticky; top: 0; background: #1f4e78; color: #fff; padding: 8px 10px; text-align: left; cursor: pointer; white-space: nowrap; user-select: none; }
        thead th.num { text-align: right; }
        tbody td { padding: 6px 10px; border-top: 1px solid #eee; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
        tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
        tbody tr:hover { background: #f0f6ff; }
        tbody tr.junkrow { color: #b00; opacity: 0.65; }
        td.drop { color: #008000; font-weight: 600; }
        a { color: #0563c1; }
        .loading { padding: 16px; color: #666; text-align: center; }
      `}</style>
    </main>
  );
}
