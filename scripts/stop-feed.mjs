// Stop a feed for the live money shot. This does NOT delete anything — it simply stops
// ingesting the flip sourcetype, so its real last(_time) freezes. Re-run Backstop and a
// detection that depended on it flips green->BLIND, stamped with the last row's real _time.
//
// The app's /api/feed endpoint does the same thing for the in-UI button. This CLI exists
// so the flip can be driven from a terminal during a demo too.
//
//   node scripts/stop-feed.mjs            stop the default flip sourcetype (zeek_conn)
//   node scripts/stop-feed.mjs <st>       stop a specific sourcetype
//   node scripts/stop-feed.mjs --resume <st>   push a fresh event to bring it back green

import { loadEnv } from '../lib/env.mjs';
loadEnv();
import { SplunkClient } from '../lib/splunk.mjs';
import { DEMO_INDEX, FLIP_SOURCETYPE } from '../lib/detections.mjs';

const args = process.argv.slice(2);
const resume = args.includes('--resume');
const st = args.find((a) => !a.startsWith('--')) || FLIP_SOURCETYPE;

const sp = new SplunkClient();

(async () => {
  await sp.login();
  if (resume) {
    const line = `${new Date().toISOString()} id.orig_h=10.2.3.4 id.resp_h=10.2.7.19 id.resp_p=445 proto=tcp duration=0.42 orig_bytes=1200`;
    await sp.ingest(DEMO_INDEX, st, 'backstop_seed', line);
    console.log(`resumed ${st}: pushed a fresh event (now). Re-run Backstop — it goes green.`);
    return;
  }
  // "Stopping" = we simply cease ingesting. To make the freeze immediate and visible we
  // report the current last(_time): that is the last row this detection will ever see.
  const rows = await sp.search(
    `| tstats latest(_time) as last where index=${DEMO_INDEX} sourcetype=${st}`,
    { earliest: '-30d', latest: 'now' }
  );
  const last = rows[0]?.last;
  console.log(`FEED STOPPED for sourcetype=${st}.`);
  console.log(`  No more events will be ingested. Last row's real _time: ${last} (epoch).`);
  console.log(`  Re-run Backstop (or the app's Run screen) — the detection on ${st} flips to BLIND,`);
  console.log(`  stamped with that exact timestamp. Re-derive it yourself:`);
  console.log(`    | tstats latest(_time) as last where index=${DEMO_INDEX} sourcetype=${st}`);
})().catch((e) => {
  console.error('STOP-FEED ERROR:', e.message || e);
  process.exit(1);
});
