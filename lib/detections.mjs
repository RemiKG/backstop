// The labelled SAMPLE detection estate + the sourcetypes it depends on. This is the
// clearly-separated demo path: only the SOURCE detections are seeded (each prefixed
// "Backstop Demo —" and pinned to the sandbox index). The parse, freshness sweep,
// exposure grade, and live flip all run through the EXACT same real mechanic.
//
// Each detection pins index=backstop_demo + a real sourcetype. The seeder ingests data
// for each sourcetype at a chosen recency, so the blind/aging/healthy split is produced
// by REAL timestamps — not asserted here.

export const DEMO_INDEX = 'backstop_demo';

// freshnessDays: how long ago this sourcetype last reported (real _time on ingest).
//   small (< window) => HEALTHY,  ~window => AGING,  >> window => BLIND.
// window is the detection's dispatch.earliest magnitude.
export const SOURCETYPES = [
  { sourcetype: 'linux_secure', freshnessDays: 4.0, kind: 'auth' }, // BLIND — 4 days silent
  { sourcetype: 'wineventlog_security', freshnessDays: 0.02, kind: 'winauth' }, // healthy
  { sourcetype: 'cisco_asa', freshnessDays: 2.5, kind: 'firewall' }, // BLIND
  { sourcetype: 'aws_cloudtrail', freshnessDays: 0.01, kind: 'cloud' }, // healthy
  { sourcetype: 'okta_system', freshnessDays: 0.06, kind: 'idp' }, // AGING — ~1.4h on a -2h window
  { sourcetype: 'sysmon', freshnessDays: 0.005, kind: 'edr' }, // healthy
  { sourcetype: 'nginx_access', freshnessDays: 0.01, kind: 'web' }, // healthy
  { sourcetype: 'dns_query', freshnessDays: 6.0, kind: 'dns' }, // BLIND
  { sourcetype: 'o365_management', freshnessDays: 0.125, kind: 'o365' }, // AGING — ~3h on a -4h window
  { sourcetype: 'zeek_conn', freshnessDays: 0.008, kind: 'netflow' }, // healthy — lateral-movement
  { sourcetype: 'paloalto_traffic', freshnessDays: 0.0003, kind: 'ngfw', flip: true }, // LIVE FLIP target — short window + heartbeat
];

// The detection estate. window = dispatch.earliest. Each is a believable blue-team alert.
export const DETECTIONS = [
  {
    title: 'Brute Force — Failed Auth Spike',
    sourcetype: 'linux_secure',
    window: '-4h',
    cron: '*/5 * * * *',
    action: 'email',
    desc: 'Linux failed-password bursts per user — credential-access brute force on SSH/PAM.',
    spl: 'index=backstop_demo sourcetype=linux_secure action=failure | bin _time span=5m | stats count by user, _time | where count > 10',
  },
  {
    title: 'Windows Account Lockout Storm',
    sourcetype: 'wineventlog_security',
    window: '-1h',
    cron: '*/10 * * * *',
    action: 'webhook',
    desc: 'Windows Security EventCode 4740 lockouts — credential-access / password spray.',
    spl: 'index=backstop_demo sourcetype=wineventlog_security EventCode=4740 | stats count by Account_Name',
  },
  {
    title: 'Firewall Deny Surge to New Country',
    sourcetype: 'cisco_asa',
    window: '-6h',
    cron: '*/15 * * * *',
    action: 'email',
    desc: 'Cisco ASA deny spikes to rare destinations — command-and-control / exfiltration scouting.',
    spl: 'index=backstop_demo sourcetype=cisco_asa action=deny | stats count by dest_ip, src_ip | where count > 50',
  },
  {
    title: 'AWS Root Account Activity',
    sourcetype: 'aws_cloudtrail',
    window: '-24h',
    cron: '0 * * * *',
    action: 'email',
    desc: 'CloudTrail root-user API calls — privilege-escalation / suspicious admin activity.',
    spl: 'index=backstop_demo sourcetype=aws_cloudtrail userIdentity.type=Root | stats count by eventName, sourceIPAddress',
  },
  {
    title: 'Okta Impossible Travel',
    sourcetype: 'okta_system',
    window: '-2h',
    cron: '*/10 * * * *',
    action: 'webhook',
    desc: 'Okta sign-ins from distant geos within minutes — credential-access / account takeover.',
    spl: 'index=backstop_demo sourcetype=okta_system eventType=user.session.start | stats dc(client.geographicalContext.country) as countries by actor.alternateId | where countries > 1',
  },
  {
    title: 'Suspicious PowerShell Encoded Command',
    sourcetype: 'sysmon',
    window: '-1h',
    cron: '*/5 * * * *',
    action: 'email,webhook',
    desc: 'Sysmon process-create with -enc / base64 PowerShell — execution / defense-evasion.',
    spl: 'index=backstop_demo sourcetype=sysmon EventID=1 CommandLine="*-enc*" | stats count by Computer, User',
  },
  {
    title: 'Web Path Traversal Probe',
    sourcetype: 'nginx_access',
    window: '-2h',
    cron: '*/5 * * * *',
    action: '',
    desc: 'Nginx requests containing ../ traversal sequences — reconnaissance / exploitation.',
    spl: 'index=backstop_demo sourcetype=nginx_access uri="*..*" status=200 | stats count by clientip',
  },
  {
    title: 'DNS Tunneling — Long Subdomains',
    sourcetype: 'dns_query',
    window: '-4h',
    cron: '*/15 * * * *',
    action: 'email',
    desc: 'Abnormally long DNS query names — exfiltration / C2 over DNS.',
    spl: 'index=backstop_demo sourcetype=dns_query | eval qlen=len(query) | where qlen > 50 | stats count by src_ip, query',
  },
  {
    title: 'O365 Mass File Download',
    sourcetype: 'o365_management',
    window: '-4h',
    cron: '*/15 * * * *',
    action: 'email',
    desc: 'SharePoint/OneDrive bulk FileDownloaded by one user — exfiltration / insider risk.',
    spl: 'index=backstop_demo sourcetype=o365_management Operation=FileDownloaded | stats count by UserId | where count > 100',
  },
  {
    title: 'Lateral Movement — New Internal Connections',
    sourcetype: 'zeek_conn',
    window: '-2h',
    cron: '*/5 * * * *',
    action: 'webhook',
    desc: 'Zeek conn spikes between internal hosts on admin ports — lateral movement.',
    spl: 'index=backstop_demo sourcetype=zeek_conn id.resp_p IN (445,3389,5985) | stats dc(id.resp_h) as targets by id.orig_h | where targets > 5',
  },
  {
    // The LIVE FLIP detection. Short window (-2m) + a heartbeat keeps it genuinely GREEN
    // while the feed flows; stop the feed and now-last crosses 2 minutes within seconds.
    title: 'C2 Beacon — Periodic Egress',
    sourcetype: 'paloalto_traffic',
    window: '-2m',
    cron: '*/1 * * * *',
    action: 'email,webhook',
    desc: 'Palo Alto egress at fixed cadence to a single host — command-and-control beaconing.',
    spl: 'index=backstop_demo sourcetype=paloalto_traffic action=allow | stats count by dest_ip, src_ip | where count > 20',
  },
];

// The sourcetype targeted by the live green->BLIND flip (short window + heartbeat).
export const FLIP_SOURCETYPE = 'paloalto_traffic';

// A fresh event line for the flip sourcetype — used by the heartbeat to keep it green.
export function flipHeartbeatLine() {
  const ts = new Date().toISOString();
  return `${ts} action=allow src_ip=10.2.3.4 dest_ip=203.0.113.7 app=ssl bytes=${1000 + Math.floor(Math.random() * 4000)} rule=egress`;
}
