import { NextResponse } from 'next/server';
import { createAndRun, getJob } from '../../../lib/searchJobs';

export const dynamic = 'force-dynamic';

// Start a search job.
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch {}
  const text = (body.text || '').trim();
  if (!text) return NextResponse.json({ error: 'Type what you are looking for.' }, { status: 400 });
  const job = createAndRun(text);
  return NextResponse.json(job);
}

// Poll a search job's status/results.
export function GET(req) {
  const id = req.nextUrl.searchParams.get('id');
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  return NextResponse.json(job);
}
