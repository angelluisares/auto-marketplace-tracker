'use client';
import { useState, useEffect, useCallback } from 'react';

export default function MetrosPage() {
  const [metros, setMetros] = useState([]);
  const [labels, setLabels] = useState({});
  const [order, setOrder] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/metros');
    const j = await r.json();
    setMetros(j.metros || []);
    setLabels(j.regionLabels || {});
    setOrder(j.regionOrder || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (slug, enabled) => {
    setMetros(ms => ms.map(m => m.slug === slug ? { ...m, enabled } : m)); // optimistic
    await fetch('/api/metros', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, enabled }) });
  };

  const bulk = async (region, enabled) => {
    const r = await fetch('/api/metros', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region, enabled }) });
    const j = await r.json();
    if (j.metros) setMetros(j.metros);
  };

  const byRegion = region => metros.filter(m => m.region === region);
  const enabledCount = list => list.filter(m => m.enabled).length;
  const totalEnabled = enabledCount(metros);

  return (
    <main>
      <header>
        <h1>Metros</h1>
        <span className="meta">{totalEnabled} of {metros.length} enabled nationwide</span>
        <a className="link" href="/search">find a vehicle →</a>
        <a className="link" href="/">browse all →</a>
      </header>

      <p className="intro">
        Turn metros on/off per region. Searches and scheduled runs scrape only the <strong>enabled</strong> metros in the
        chosen region. (Facebook only exposes name-based locations for major metros — that’s why Mountain &amp; Pacific have fewer.)
      </p>

      <div className="bulkbar">
        <button onClick={() => bulk('all', true)}>Enable all</button>
        <button onClick={() => bulk('all', false)}>Disable all</button>
      </div>

      {loading ? <div className="muted">Loading…</div> : (
        <div className="regions">
          {order.map(region => {
            const list = byRegion(region);
            return (
              <section key={region} className="region">
                <div className="rhead">
                  <h2>{labels[region] || region}</h2>
                  <span className="count">{enabledCount(list)}/{list.length}</span>
                  <button className="mini" onClick={() => bulk(region, true)}>all on</button>
                  <button className="mini" onClick={() => bulk(region, false)}>all off</button>
                </div>
                <div className="chips">
                  {list.map(m => (
                    <label key={m.slug} className={'metro' + (m.enabled ? ' on' : '')}>
                      <input type="checkbox" checked={m.enabled} onChange={e => toggle(m.slug, e.target.checked)} />
                      <span>{m.label}</span>
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; font: 14px/1.4 system-ui, sans-serif; color: #1a1a1a; background: #f5f6f8; }
        main { padding: 18px 22px; max-width: 1100px; margin: 0 auto; }
        header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 6px; flex-wrap: wrap; }
        h1 { font-size: 22px; margin: 0; }
        .meta { color: #666; font-size: 13px; }
        .link { color: #0563c1; font-size: 13px; text-decoration: none; margin-left: auto; }
        header .link + .link { margin-left: 14px; }
        .intro { color: #555; font-size: 13px; margin: 6px 0 14px; }
        .bulkbar { margin-bottom: 14px; display: flex; gap: 8px; }
        .bulkbar button { padding: 6px 12px; border: 1px solid #ccc; background: #fff; border-radius: 6px; font-size: 13px; cursor: pointer; }
        .muted { color: #666; }
        .regions { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
        .region { background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 12px 14px; }
        .rhead { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .rhead h2 { font-size: 15px; margin: 0; }
        .rhead .count { color: #1f4e78; font-weight: 600; font-size: 13px; }
        .mini { margin-left: 0; font-size: 11px; padding: 2px 8px; border: 1px solid #cdddec; background: #eef4fa; color: #1f4e78; border-radius: 999px; cursor: pointer; }
        .rhead .mini:first-of-type { margin-left: auto; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .metro { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid #ddd; border-radius: 999px; font-size: 12.5px; cursor: pointer; background: #fafafa; color: #888; user-select: none; }
        .metro.on { background: #eaf3ea; border-color: #bcdcbc; color: #1a4d1a; }
        .metro input { margin: 0; }
      `}</style>
    </main>
  );
}
