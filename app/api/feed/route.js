// Live-flip control for the money shot. The flip sourcetype has a short (-2m) window.
//   GET  /api/feed                 -> current last(_time) + computed state of the flip detection
//   POST /api/feed {action:"start"} -> push a fresh heartbeat event (keeps it GREEN)
//   POST /api/feed {action:"stop"}  -> report the frozen last(_time): the last row it'll ever see
//
// "Stopping" is honest: we simply cease pushing heartbeats. The detection flips because
// now - last(_time) crosses its real window — arithmetic on a real timestamp, re-derivable.

import { SplunkClient } from '@/lib/splunk.mjs';
import { DEMO_INDEX, FLIP_SOURCETYPE, flipHeartbeatLine } from '@/lib/detections.mjs';

export const dynamic = 'force-dynamic';

const FLIP_WINDOW_SEC = 120;

async function flipState(sp) {
  const rows = await sp.search(
    `| tstats latest(_time) as last where index=${DEMO_INDEX} sourcetype=${FLIP_SOURCETYPE}`,
    { earliest: '-30d', latest: 'now' }
  );
  const last = rows[0]?.last ? Math.floor(Number(rows[0].last)) : null;
  const now = Math.floor(Date.now() / 1000);
  const age = last == null ? null : now - last;
  let state = 'blind';
  if (last != null) state = age > FLIP_WINDOW_SEC ? 'blind' : age > FLIP_WINDOW_SEC * 0.5 ? 'aging' : 'healthy';
  return { sourcetype: FLIP_SOURCETYPE, index: DEMO_INDEX, last, age, now, windowSeconds: FLIP_WINDOW_SEC, state };
}

export async function GET() {
  try {
    const sp = new SplunkClient();
    await sp.login();
    return Response.json(await flipState(sp));
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { action } = await req.json().catch(() => ({}));
    const sp = new SplunkClient();
    await sp.login();
    if (action === 'start') {
      await sp.ingest(DEMO_INDEX, FLIP_SOURCETYPE, 'backstop_seed', flipHeartbeatLine());
    }
    // For "stop" we do nothing to Splunk — we just stop the heartbeat client-side.
    // Wait briefly so the just-ingested row is searchable before we report state on start.
    if (action === 'start') await new Promise((s) => setTimeout(s, 1200));
    return Response.json({ action: action || 'status', ...(await flipState(sp)) });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
