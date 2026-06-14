// Seed the SAMPLE detection estate + its data into the user's own Splunk (real index,
// real ingest, real saved searches). The blind/aging/healthy split is produced by the
// REAL _time of the ingested events — this script asserts nothing about health.
//
//   node scripts/seed.mjs            seed index + data + detections
//   node scripts/seed.mjs --teardown remove demo detections (data ages out on its own)
//
// Each event carries a leading ISO timestamp so Splunk extracts a real _time; "blind"
// sourcetypes are dated days ago, "fresh" ones seconds ago.

import { loadEnv } from '../lib/env.mjs';
loadEnv();
import { SplunkClient } from '../lib/splunk.mjs';
import { DEMO_INDEX, SOURCETYPES, DETECTIONS } from '../lib/detections.mjs';

const teardown = process.argv.includes('--teardown');
const sp = new SplunkClient();

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));
const pick = (arr) => arr[rand(0, arr.length)];

const USERS = ['alice', 'bob', 'carol', 'dave', 'svc_backup', 'admin', 'jsmith', 'mwong'];
const IPS = ['10.2.3.4', '10.2.7.19', '192.168.1.50', '203.0.113.7', '198.51.100.23', '172.16.4.9'];
const HOSTS = ['web01', 'db02', 'dc01', 'app03', 'jump01', 'file02'];

// Build a believable line for a sourcetype, dated `msAgo` ms in the past.
function lineFor(st, msAgo) {
  const ts = iso(msAgo);
  switch (st) {
    case 'linux_secure':
      return `${ts} host=${pick(HOSTS)} sshd[${rand(1000, 9999)}]: Failed password for ${pick(USERS)} from ${pick(IPS)} port ${rand(20000, 60000)} ssh2 action=failure`;
    case 'wineventlog_security':
      return `${ts} EventCode=4740 Account_Name=${pick(USERS)} Caller_Computer_Name=${pick(HOSTS)} action=lockout`;
    case 'cisco_asa':
      return `${ts} %ASA-4-106023: Deny tcp src outside:${pick(IPS)}/${rand(1024, 65000)} dst inside:${pick(IPS)}/443 action=deny dest_ip=${pick(IPS)} src_ip=${pick(IPS)}`;
    case 'aws_cloudtrail':
      return `${ts} {"eventName":"ConsoleLogin","userIdentity":{"type":"Root"},"sourceIPAddress":"${pick(IPS)}","awsRegion":"us-east-1"}`;
    case 'okta_system':
      return `${ts} eventType=user.session.start actor.alternateId=${pick(USERS)}@corp.com client.geographicalContext.country=${pick(['US', 'DE', 'BR', 'SG'])} outcome.result=SUCCESS`;
    case 'sysmon':
      return `${ts} EventID=1 Computer=${pick(HOSTS)} User=${pick(USERS)} Image=C:\\Windows\\System32\\powershell.exe CommandLine="powershell.exe -enc ${Buffer.from('whoami').toString('base64')}"`;
    case 'nginx_access':
      return `${ts} ${pick(IPS)} - - "GET /app/../../etc/passwd HTTP/1.1" 200 ${rand(100, 9000)} uri="/app/../../etc/passwd" clientip=${pick(IPS)} status=200`;
    case 'dns_query':
      return `${ts} src_ip=${pick(IPS)} query=${Buffer.from(Math.random().toString()).toString('hex').slice(0, 60)}.exfil.example.com qtype=TXT`;
    case 'o365_management':
      return `${ts} Operation=FileDownloaded UserId=${pick(USERS)}@corp.com SourceFileName=report${rand(1, 999)}.xlsx ClientIP=${pick(IPS)}`;
    case 'zeek_conn':
      return `${ts} id.orig_h=${pick(IPS)} id.resp_h=${pick(IPS)} id.resp_p=${pick([445, 3389, 5985])} proto=tcp duration=${(Math.random() * 5).toFixed(3)} orig_bytes=${rand(100, 9000)}`;
    case 'paloalto_traffic':
      return `${ts} action=allow src_ip=${pick(IPS)} dest_ip=203.0.113.7 app=ssl bytes=${rand(1000, 5000)} rule=egress`;
    default:
      return `${ts} sourcetype=${st} msg=event n=${rand(1, 100)}`;
  }
}

async function seedSourcetype(st, freshnessDays) {
  // A small burst of events ending at `freshnessDays` ago (the last-seen timestamp),
  // plus a few older ones so first/last span is realistic.
  const baseMs = freshnessDays * 86400 * 1000;
  const n = 12;
  for (let i = 0; i < n; i++) {
    // newest event sits exactly at freshnessDays ago; older ones spread back ~2h
    const jitter = i === 0 ? 0 : rand(60_000, 2 * 3600_000);
    const line = lineFor(st, baseMs + jitter);
    await sp.ingest(DEMO_INDEX, st, `backstop_seed`, line);
  }
}

async function seedDetections() {
  for (const d of DETECTIONS) {
    const name = `Backstop Demo — ${d.title}`;
    const actionProps = {};
    if (d.action) {
      actionProps.actions = d.action;
      if (d.action.includes('email')) {
        actionProps['action.email'] = '1';
        actionProps['action.email.to'] = 'soc@example.com';
      }
      if (d.action.includes('webhook')) {
        actionProps['action.webhook'] = '1';
        actionProps['action.webhook.param.url'] = 'https://soc.example.com/backstop-hook';
      }
    }
    await sp.upsertSavedSearch(name, {
      search: d.spl,
      description: d.desc,
      'dispatch.earliest_time': d.window,
      'dispatch.latest_time': 'now',
      cron_schedule: d.cron,
      is_scheduled: '1',
      'alert.track': '1',
      ...actionProps,
      'alert_type': 'number of events',
      'alert_comparator': 'greater than',
      'alert_threshold': '0',
    });
  }
}

async function teardownDetections() {
  for (const d of DETECTIONS) {
    const name = `Backstop Demo — ${d.title}`;
    const ok = await sp.deleteSavedSearch(name);
    console.log(`  delete ${name}: ${ok ? 'ok' : 'skip'}`);
  }
}

(async () => {
  await sp.login();
  console.log('logged in to', process.env.SPLUNK_URL);

  if (teardown) {
    console.log('tearing down demo detections...');
    await teardownDetections();
    console.log('done. (Sample data ages out of', DEMO_INDEX, 'naturally.)');
    return;
  }

  const created = await sp.ensureIndex(DEMO_INDEX);
  console.log(`index ${DEMO_INDEX}: ${created ? 'created' : 'exists'}`);

  console.log('seeding sourcetypes (real _time on each event)...');
  for (const s of SOURCETYPES) {
    await seedSourcetype(s.sourcetype, s.freshnessDays);
    console.log(`  ${s.sourcetype.padEnd(22)} last≈${s.freshnessDays}d ago`);
  }

  console.log('seeding detection estate (real saved searches)...');
  await seedDetections();
  console.log(`  ${DETECTIONS.length} detections upserted (prefix "Backstop Demo —")`);

  console.log('\nWaiting 8s for index-time, then verifying freshness...');
  await new Promise((s) => setTimeout(s, 8000));
  const rows = await sp.search(
    `| tstats latest(_time) as last count where index=${DEMO_INDEX} by sourcetype`,
    { earliest: '-30d', latest: 'now' }
  );
  for (const r of rows.sort((a, b) => Number(b.last) - Number(a.last))) {
    const ageH = ((Date.now() / 1000 - Number(r.last)) / 3600).toFixed(1);
    console.log(`  ${String(r.sourcetype).padEnd(22)} last=${r.last}  (${ageH}h ago)  count=${r.count}`);
  }
  console.log('\nSeed complete. Run the app and open /run.');
})().catch((e) => {
  console.error('SEED ERROR:', e.message || e);
  process.exit(1);
});
