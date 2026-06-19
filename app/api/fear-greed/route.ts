import { NextResponse } from 'next/server';
import { getFearGreed } from '@/app/lib/fearGreed';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getFearGreed();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
