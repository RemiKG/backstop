// Exposure grader — turns "this detection is BLIND" into "your only credential-access
// coverage has been blind 4 days." Two modes, the active one always shown on the badge:
//
//   1) Foundation-sec Hosted Model (best-effort). If FOUNDATION_SEC_URL is set, each
//      blind detection's title+description is scored for technique class + severity by
//      the hosted security model. This is the "Best Use of Hosted Models" target.
//   2) Transparent heuristic fallback (always available). Severity is computed from the
//      detection's OWN metadata — cron tightness + alert action + auth/privilege/exfil
//      category keywords — so the rank degrades, it never disappears, and it is fully
//      explainable (we list the exact signals that produced the grade).
//
// The grade is advisory (a model's / heuristic's opinion). The blind/healthy FACT is
// arithmetic in health.mjs and is kept visually separate.

const TECHNIQUE_SIGNALS = [
  { cls: 'credential-access', sev: 'HIGH', kw: /\b(brute|brute-?force|failed (login|auth|password)|credential|password spray|kerbero|ntlm|auth(entication)? spike|lockout|impossible travel|account takeover|session\.start|login)\b/i },
  { cls: 'privilege-escalation', sev: 'HIGH', kw: /\b(privilege|sudo|setuid|root (account|user)|admin (grant|added|activity)|elevat|uac|token (theft|manip))\b/i },
  { cls: 'lateral-movement', sev: 'HIGH', kw: /\b(lateral|psexec|smb|rdp|remote (exec|service)|wmi|pass[- ]the[- ]hash|internal connection)\b/i },
  { cls: 'exfiltration', sev: 'HIGH', kw: /\b(exfil|data (transfer|loss)|mass (file )?download|bulk download|upload|dns tunnel|large (outbound|egress)|insider)\b/i },
  { cls: 'command-and-control', sev: 'HIGH', kw: /\b(c2|command (and|&) control|beacon|known bad (ip|domain)|threat ?intel|deny (surge|spike)|new country|rare destination)\b/i },
  { cls: 'persistence', sev: 'MED', kw: /\b(persist|cron job|scheduled task|registry run|startup|new service|account creat)\b/i },
  { cls: 'defense-evasion', sev: 'MED', kw: /\b(clear(ed)? (log|event)|disable (av|audit|firewall)|wevtutil|tamper)\b/i },
  { cls: 'execution', sev: 'MED', kw: /\b(powershell|encoded command|-enc|malicious (process|binary)|process (creation|spawn))\b/i },
  { cls: 'reconnaissance', sev: 'LOW', kw: /\b(port scan|recon|enumerat|nmap|path traversal|traversal probe)\b/i },
];

const SEV_RANK = { HIGH: 3, MED: 2, LOW: 1 };

// Cron tightness: a detection running every few minutes is operationally critical.
function cronTightnessMinutes(cron) {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  const minField = parts[0] || '';
  const m = minField.match(/\*\/(\d+)/);
  if (m) return parseInt(m[1], 10);
  if (minField === '*') return 1;
  if (/^\d+$/.test(minField)) return 60; // once an hour at a fixed minute
  return null;
}

// The transparent heuristic — fully explainable, lists the exact signals used.
export function heuristicGrade(detection) {
  const hay = `${detection.name} ${detection.description || ''} ${detection.search || ''}`;
  let technique = null;
  let baseSev = 'LOW';
  for (const sig of TECHNIQUE_SIGNALS) {
    if (sig.kw.test(hay)) {
      if (!technique || SEV_RANK[sig.sev] > SEV_RANK[baseSev]) {
        technique = sig.cls;
        baseSev = sig.sev;
      }
    }
  }
  const signals = [];
  let score = SEV_RANK[baseSev] || 1;
  if (technique) signals.push(`technique=${technique}`);

  const tight = cronTightnessMinutes(detection.cron);
  if (tight != null && tight <= 15) {
    score += 1;
    signals.push(`tight cron (every ${tight}m)`);
  }
  const hasAction = !!(detection.actions && detection.actions.trim());
  if (hasAction) {
    score += 1;
    signals.push(`alert action (${detection.actions.split(',')[0].trim()})`);
  }

  let severity = 'LOW';
  if (score >= 4) severity = 'HIGH';
  else if (score >= 2) severity = 'MED';

  return {
    mode: 'heuristic',
    technique: technique || 'uncategorised',
    severity,
    signals,
    verdict: buildVerdict(detection, technique, severity),
  };
}

function buildVerdict(detection, technique, severity) {
  if (!technique) {
    return `${detection.name} is blind. Severity ${severity} from its own cron/action metadata.`;
  }
  const t = technique.replace(/-/g, ' ');
  if (severity === 'HIGH') return `Your only ${t} coverage of this kind is down.`;
  if (severity === 'MED') return `${t.charAt(0).toUpperCase() + t.slice(1)} coverage degraded while this is blind.`;
  return `${t.charAt(0).toUpperCase() + t.slice(1)} signal lost while this is blind.`;
}

export function foundationSecConfigured() {
  return !!process.env.FOUNDATION_SEC_URL;
}

// Foundation-sec Hosted Model seam. Activates the moment FOUNDATION_SEC_URL exists.
async function foundationSecGrade(detection) {
  const url = process.env.FOUNDATION_SEC_URL;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.FOUNDATION_SEC_KEY) headers.Authorization = 'Bearer ' + process.env.FOUNDATION_SEC_KEY;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: detection.name,
      description: detection.description || '',
      spl: detection.search || '',
      task: 'classify_detection_technique_and_severity',
    }),
  });
  if (r.status >= 400) throw new Error('foundation-sec ' + r.status);
  const j = await r.json();
  const technique = j.technique || j.technique_class || 'uncategorised';
  const severity = (j.severity || 'MED').toUpperCase();
  return {
    mode: 'foundation-sec',
    technique,
    severity,
    signals: ['Foundation-sec Hosted Model'],
    verdict: j.verdict || buildVerdict(detection, technique, severity),
  };
}

// Grade a single detection, preferring the hosted model, falling back honestly.
export async function gradeExposure(detection) {
  if (foundationSecConfigured()) {
    try {
      return await foundationSecGrade(detection);
    } catch {
      // honest fallback — never lose the rank
    }
  }
  return heuristicGrade(detection);
}

export { SEV_RANK };
