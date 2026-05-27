import { NextResponse } from 'next/server';
import { queryListings, facets } from '../../../lib/db';

export const dynamic = 'force-dynamic'; // always read fresh from the DB

export function GET(req) {
  const sp = req.nextUrl.searchParams;
  const bool = k => sp.get(k) === '1' || sp.get(k) === 'true';
  try {
    const rows = queryListings({
      q: sp.get('q') || undefined,
      make: sp.get('make') || undefined,
      state: sp.get('state') || undefined,
      vansOnly: bool('vansOnly'),
      hideJunk: bool('hideJunk'),
      activeOnly: bool('activeOnly'),
      minPrice: sp.get('minPrice') || undefined,
      maxPrice: sp.get('maxPrice') || undefined,
      maxMileage: sp.get('maxMileage') || undefined,
      sort: sp.get('sort') || undefined,
      dir: sp.get('dir') || undefined,
    });
    return NextResponse.json({ count: rows.length, facets: facets(), rows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
