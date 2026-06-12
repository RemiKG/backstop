// Hand-back: persist the coverage-gap map into the user's OWN Splunk as a CSV lookup
// (backstop_coverage.csv) and report the scheduled Backstop meta-detection. GET reads
// the lookup back so the UI shows real persisted rows.

import { SplunkClient } from '@/lib/splunk.mjs';
import { runBackstop } from '@/lib/agent.mjs';
import { fmtTimestamp, humanAge } from '@/lib/health.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOOKUP = 'backstop_coverage';
const META_SEARCH = 'Backstop — Coverage Gap Monitor';

export async function GET() {
  try {
    const sp = new SplunkClient();
    await sp.login();
    const rows = await sp.readLookup(LOOKUP);
    return Response.json({ lookup: LOOKUP, rows });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const sp = new SplunkClient();
    await sp.login();

    // Recompute fresh so the persisted map matches the current live state.
    const result = await runBackstop({ useGemini: body.gemini !== false, sampleOnly: body.all !== true });

    const rows = result.detections.map((d) => ({
      detection: d.name,
      dependency: d.health.deadDependency || (d.dependencies.sourcetypes[0] ? `sourcetype=${d.dependencies.sourcetypes[0]}` : ''),
      state: d.health.state,
      last_seen: d.health.last ? fmtTimestamp(d.health.last) : 'never',
      age: d.health.last ? humanAge(d.health.ageSeconds) : '',
      exposure: d.exposure ? `${d.exposure.severity}/${d.exposure.technique}` : '',
    }));

    await sp.writeLookup(LOOKUP, rows);

    // Install the scheduled Backstop meta-detection that watches the watchers.
    const metaSpl =
      `| tstats latest(_time) as last by index, sourcetype ` +
      `| eval age=now()-last ` +
      `| where age > 14400 ` +
      `| eval gap="data silent ".tostring(round(age/3600,1))."h" ` +
      `| table index, sourcetype, last, gap`;
    let scheduled = false;
    try {
      await sp.upsertSavedSearch(META_SEARCH, {
        search: metaSpl,
        description:
          'Backstop meta-detection: fires when any (index, sourcetype) a detection depends on has gone silent past its window. The one alert that fires when an alert can\'t.',
        'dispatch.earliest_time': '-30d',
        'dispatch.latest_time': 'now',
        cron_schedule: '*/15 * * * *',
        is_scheduled: '1',
        actions: 'email',
        'action.email': '1',
        'action.email.to': 'soc@example.com',
        alert_type: 'number of events',
        alert_comparator: 'greater than',
        alert_threshold: '0',
      });
      scheduled = true;
    } catch {
      scheduled = false;
    }

    const persisted = await sp.readLookup(LOOKUP);
    return Response.json({
      lookup: LOOKUP,
      written: rows.length,
      rows: persisted.length ? persisted : rows,
      scheduledSearch: { name: META_SEARCH, cron: '*/15 * * * *', action: 'email', installed: scheduled },
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
