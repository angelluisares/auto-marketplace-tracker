import { NextResponse } from 'next/server';
import { models } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const make = req.nextUrl.searchParams.get('make') || '';
  try {
    return NextResponse.json({ models: await models(make) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
