// Connection + agent status for the Settings page and the connected pill. Never returns
// secret values — only whether each integration is configured and reachable, plus the
// transport mode in force (MCP Server vs REST proxy) so the UI never hides which it is.

import { SplunkClient } from '@/lib/splunk.mjs';
import { geminiConfigured, VERTEX_META } from '@/lib/gemini.mjs';
import { foundationSecConfigured } from '@/lib/exposure.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const out = {
    splunk: { configured: !!(process.env.SPLUNK_URL && process.env.SPLUNK_USER && process.env.SPLUNK_PASS), connected: false, host: hostOnly(process.env.SPLUNK_URL), version: null, roundTripMs: null, transport: 'rest-proxy', mcpAvailable: false, deepLinkBase: null },
    gemini: { configured: geminiConfigured(), ...(geminiConfigured() ? VERTEX_META : {}) },
    foundationSec: { configured: foundationSecConfigured(), mode: foundationSecConfigured() ? 'foundation-sec' : 'heuristic' },
  };
  if (out.splunk.configured) {
    try {
      const sp = new SplunkClient();
      const t0 = Date.now();
      await sp.login();
      out.splunk.roundTripMs = Date.now() - t0;
      out.splunk.connected = true;
      out.splunk.deepLinkBase = sp.base;
      out.splunk.mcpAvailable = await sp.mcpAvailable();
      out.splunk.transport = out.splunk.mcpAvailable ? 'mcp-server' : 'rest-proxy';
      try {
        const info = await sp.search('| rest /services/server/info | fields version', { earliest: '-1m', latest: 'now' });
        out.splunk.version = info[0]?.version || null;
      } catch {}
    } catch (e) {
      out.splunk.error = String(e.message || e).slice(0, 120);
    }
  }
  return Response.json(out);
}

function hostOnly(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || null;
  }
}
