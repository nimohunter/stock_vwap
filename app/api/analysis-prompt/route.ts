import { NextRequest } from 'next/server';
import { loadLocalBars } from '@/app/lib/localData';
import { loadFundamentals } from '@/app/lib/fundamentalsData';
import { buildAnalysisPrompt } from '@/app/lib/analysisPrompt';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return new Response('symbol required', { status: 400 });

  try {
    const prompt = buildAnalysisPrompt(symbol, loadLocalBars(symbol), loadFundamentals(symbol));
    return new Response(prompt, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
}
