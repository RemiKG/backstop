// SPL dependency parse. Two layers:
//   1) A deterministic regex extractor — always runs, always trustworthy. Pulls
//      index=, sourcetype=, source= (literal values) and the search window.
//   2) Gemini accelerator (optional) — reads the full SPL and emits a structured
//      dependency set, catching things the regex misses (e.g. tstats WHERE clauses,
//      macros it can resolve). It NEVER decides health; it only enriches dependencies.
//
// If Gemini is off or fails, the regex result drives a correct (if blunter) map.
// If the SPL is too dynamic to pin down a sourcetype, the detection is flagged
// dependency-unknown rather than assumed healthy.

import { generate, geminiConfigured } from './gemini.mjs';

// --- window parsing: Splunk relative-time string -> seconds of lookback ---
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mon: 2592000, q: 7776000, y: 31536000 };

export function windowSeconds(earliest, fallbackSeconds = 86400) {
  if (!earliest) return fallbackSeconds;
  const e = String(earliest).trim().toLowerCase();
  if (e === 'now' || e === '0') return 0;
  // forms: -4h, -24h@h, -1d, rt-1h, @d ... we only need the magnitude of the lookback.
  const m = e.match(/-?(\d+)\s*(mon|s|m|h|d|w|q|y)\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    const u = m[2];
    return n * (UNIT_SECONDS[u] || 3600);
  }
  // @d (snap to day) with no magnitude -> treat as ~1 day window
  if (/@d/.test(e)) return 86400;
  if (/@h/.test(e)) return 3600;
  return fallbackSeconds;
}

// Extract literal index/sourcetype/source tokens from raw SPL via regex.
function regexExtract(spl) {
  const text = spl || '';
  const grab = (key) => {
    const out = new Set();
    // key=value  and  key="value"  and  key IN (a,b)
    const re = new RegExp(`\\b${key}\\s*=\\s*"([^"]+)"|\\b${key}\\s*=\\s*([\\w*:\\-./]+)`, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const v = (m[1] || m[2] || '').trim();
      if (v && v !== '*') out.add(v);
    }
    // IN (...) form
    const inRe = new RegExp(`\\b${key}\\s+IN\\s*\\(([^)]+)\\)`, 'gi');
    while ((m = inRe.exec(text))) {
      for (const part of m[1].split(',')) {
        const v = part.trim().replace(/^["']|["']$/g, '');
        if (v && v !== '*') out.add(v);
      }
    }
    return [...out];
  };
  return {
    indexes: grab('index'),
    sourcetypes: grab('sourcetype'),
    sources: grab('source'),
  };
}

// Heuristic: is this SPL too dynamic to trust a static dependency parse?
function looksDynamic(spl, extracted) {
  const t = (spl || '').toLowerCase();
  const usesMacro = /`[^`]+`/.test(spl || '');
  const usesLookupDriven = /\[\s*(inputlookup|search)\b/.test(t); // subsearch feeding the base
  const noSourcetype = extracted.sourcetypes.length === 0;
  // A pure `| rest ...` or `| inputlookup` search has no event-data dependency at all.
  const restOnly = /^\s*\|\s*(rest|inputlookup|makeresults|dbinspect)\b/.test(t);
  return { usesMacro, usesLookupDriven, restOnly, dynamic: (usesMacro || usesLookupDriven) && noSourcetype };
}

// Build the dependency set for one detection. base = regex; optionally enriched by Gemini.
export async function parseDependencies(detection, { useGemini = true } = {}) {
  const spl = detection.search || '';
  const reg = regexExtract(spl);
  const dyn = looksDynamic(spl, reg);
  const win = windowSeconds(detection.earliest, 86400);

  let geminiUsed = false;
  let merged = {
    indexes: [...reg.indexes],
    sourcetypes: [...reg.sourcetypes],
    sources: [...reg.sources],
  };

  if (useGemini && geminiConfigured() && spl.trim()) {
    try {
      const prompt = buildParsePrompt(detection);
      const raw = await generate(prompt, { maxOutputTokens: 512, temperature: 0, json: true });
      const g = JSON.parse(stripFence(raw));
      const addAll = (key) => {
        for (const v of g[key] || []) {
          const s = String(v).trim();
          if (s && s !== '*' && !merged[key].includes(s)) merged[key].push(s);
        }
      };
      addAll('indexes');
      addAll('sourcetypes');
      addAll('sources');
      geminiUsed = true;
    } catch {
      // fall back to regex silently — Gemini is an accelerator, never load-bearing
    }
  }

  // A detection with NO index and NO sourcetype dependency on event data is either a
  // |rest/|inputlookup meta-search (no event lifeline) or genuinely unparseable.
  const hasEventDep = merged.indexes.length > 0 || merged.sourcetypes.length > 0;
  const dependencyUnknown = !hasEventDep && (dyn.dynamic || dyn.usesMacro || dyn.usesLookupDriven);
  const metaSearch = dyn.restOnly && !hasEventDep;

  return {
    ...merged,
    windowSeconds: win,
    parsedBy: geminiUsed ? 'gemini+regex' : 'regex',
    dependencyUnknown,
    metaSearch,
    notes: dyn,
  };
}

function stripFence(s) {
  return String(s)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function buildParsePrompt(d) {
  return [
    'You are parsing a Splunk saved-search detection to find the DATA it depends on to fire.',
    'Read the SPL and return ONLY JSON with this exact shape:',
    '{"indexes":[...],"sourcetypes":[...],"sources":[...]}',
    'Rules:',
    '- Include only concrete literal values that the search filters on (e.g. index=auth, sourcetype=linux_secure).',
    '- Include values inside tstats WHERE clauses, IN(...) lists, and field=value filters.',
    '- Do NOT invent values. Omit wildcards like * . If none, return an empty array for that key.',
    '- Do not include field names — only index/sourcetype/source values.',
    '',
    'SPL:',
    d.search || '',
  ].join('\n');
}

export { regexExtract };
