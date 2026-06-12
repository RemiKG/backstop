import { runBackstop } from '@/lib/agent.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  const url = new URL(req.url);
  const useGemini = url.searchParams.get('gemini') !== '0';
  const sampleOnly = url.searchParams.get('all') !== '1';
  const agingFactor = parseFloat(url.searchParams.get('aging') || '0.5');
  try {
    const result = await runBackstop({ useGemini, sampleOnly, agingFactor });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
