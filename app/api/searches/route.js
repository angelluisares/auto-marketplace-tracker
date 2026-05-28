import { NextResponse } from 'next/server';
import store from '../../../lib/searchStore.js';

export const dynamic = 'force-dynamic';

// GET /api/searches            -> { searches: [...] }
// GET /api/searches?results=ID -> { search, results: [...] }  (matches now in DB, no scrape)
export async function GET(req) {
  const id = req.nextUrl.searchParams.get('results');
  if (id) {
    const row = await store.getSearch(Number(id));
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const results = await store.matchListings(store.rowToParsed(row));
    return NextResponse.json({ search: row, results });
  }
  const searches = await store.listSearches();
  return NextResponse.json({ searches });
}

// PATCH /api/searches  body: { id, scheduled, intervalMinutes }
export async function PATCH(req) {
  let body = {};
  try { body = await req.json(); } catch {}
  const { id, scheduled, intervalMinutes } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (scheduled && !intervalMinutes) return NextResponse.json({ error: 'intervalMinutes required when scheduling' }, { status: 400 });
  const row = await store.setSchedule(Number(id), !!scheduled, intervalMinutes ? Number(intervalMinutes) : null);
  return NextResponse.json({ search: row });
}

// DELETE /api/searches?id=ID
export async function DELETE(req) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await store.deleteSearch(Number(id));
  return NextResponse.json({ ok: true });
}
