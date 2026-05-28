import { NextResponse } from 'next/server';
import store from '../../../lib/metroStore.js';
import grid from '../../../lib/grid.cjs';

export const dynamic = 'force-dynamic';

// GET /api/metros -> { metros, regionLabels, regionOrder }
export async function GET() {
  const metros = await store.listMetros();
  return NextResponse.json({ metros, regionLabels: grid.REGION_LABELS, regionOrder: grid.REGION_ORDER });
}

// PATCH /api/metros
//   { slug, enabled }            -> toggle one metro
//   { region, enabled }          -> bulk toggle a region ('all' = everything)
export async function PATCH(req) {
  let body = {};
  try { body = await req.json(); } catch {}
  if (body.region) {
    await store.setRegionEnabled(body.region, !!body.enabled);
    const metros = await store.listMetros();
    return NextResponse.json({ metros });
  }
  if (body.slug) {
    const metro = await store.setEnabled(body.slug, !!body.enabled);
    return NextResponse.json({ metro });
  }
  return NextResponse.json({ error: 'slug or region required' }, { status: 400 });
}
