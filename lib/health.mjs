// The arithmetic core — proof-by-silence. A detection's health is COMPUTED from the
// real last-seen timestamp of the data it depends on, never asserted by a model:
//
//   age(dependency) = now - last(dependency)
//   BLIND   when  age >  detection.window          (it cannot have fired in-window)
//   AGING   when  age >  agingThreshold * window    (about to go blind)
//   HEALTHY otherwise
//
// 0 health states without a real latest(_time) behind them: a state cannot be
// constructed without a freshness row, so a dependency with no freshness row at all
// is itself the silence (last = never) and grades BLIND with last=null.

export const DEFAULT_AGING_FACTOR = 0.5;

// Build a freshness map keyed by "index|sourcetype" -> { last(epoch seconds), count }.
// Also a sourcetype-only fallback map (max last across indexes) for detections that
// pin a sourcetype but not an index.
export function buildFreshnessMap(tstatsRows, metadataRows) {
  const byPair = new Map(); // index|sourcetype
  const bySourcetype = new Map(); // sourcetype -> max last
  const byIndex = new Map(); // index -> max last

  for (const row of tstatsRows || []) {
    const idx = row.index || '';
    const st = row.sourcetype || '';
    const last = numTime(row.last);
    if (last == null) continue;
    byPair.set(`${idx}|${st}`, { index: idx, sourcetype: st, last });
    if (st) bySourcetype.set(st, Math.max(bySourcetype.get(st) || 0, last));
    if (idx) byIndex.set(idx, Math.max(byIndex.get(idx) || 0, last));
  }
  // metadata type=sourcetypes gives recentTime per sourcetype across all indexes —
  // a second, independent witness to last-seen (used if tstats missed it).
  for (const row of metadataRows || []) {
    const st = row.sourcetype || row.type || '';
    const last = numTime(row.lastTime || row.recentTime || row.last);
    if (st && last != null) {
      bySourcetype.set(st, Math.max(bySourcetype.get(st) || 0, last));
    }
  }
  return { byPair, bySourcetype, byIndex };
}

function numTime(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.floor(n);
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : Math.floor(d / 1000);
}

// Resolve the freshest real last-seen for a detection's dependency set.
// Returns { last, key, witness } — last is epoch seconds or null (never seen).
function resolveDependencyFreshness(dep, fmap) {
  let best = null;
  let bestKey = null;
  let witness = null;

  const consider = (last, key, w) => {
    if (last == null) return;
    if (best == null || last > best) {
      best = last;
      bestKey = key;
      witness = w;
    }
  };

  const idxs = dep.indexes.length ? dep.indexes : [null];
  const sts = dep.sourcetypes.length ? dep.sourcetypes : [null];

  // 1) exact index|sourcetype pairs (the precise lifeline)
  for (const idx of idxs) {
    for (const st of sts) {
      if (idx && st) {
        const hit = fmap.byPair.get(`${idx}|${st}`);
        if (hit) consider(hit.last, `${idx}|${st}`, 'tstats index+sourcetype');
      }
    }
  }
  // 2) sourcetype-only (detection pinned a sourcetype but not an index)
  if (best == null) {
    for (const st of dep.sourcetypes) {
      const last = fmap.bySourcetype.get(st);
      if (last != null) consider(last, st, 'sourcetype freshness');
    }
  }
  // 3) index-only (detection pinned an index but no sourcetype)
  if (best == null) {
    for (const idx of dep.indexes) {
      const last = fmap.byIndex.get(idx);
      if (last != null) consider(last, idx, 'index freshness');
    }
  }

  return { last: best, key: bestKey, witness };
}

// Compute the per-detection health verdict. nowSec defaults to wall clock.
export function computeHealth(detection, dep, fmap, opts = {}) {
  const nowSec = opts.nowSec || Math.floor(Date.now() / 1000);
  const agingFactor = opts.agingFactor ?? DEFAULT_AGING_FACTOR;
  const window = dep.windowSeconds || 86400;

  // Dependency-unknown / meta searches never get a green light from absence of parse.
  if (dep.dependencyUnknown) {
    return {
      state: 'unknown',
      last: null,
      ageSeconds: null,
      window,
      deadDependency: null,
      reason: 'SPL too dynamic to pin a data dependency — shown as a gap, never green.',
      witness: null,
    };
  }
  if (dep.metaSearch) {
    return {
      state: 'meta',
      last: null,
      ageSeconds: null,
      window,
      deadDependency: null,
      reason: 'Meta-search (|rest / |inputlookup) — no event-data lifeline to go blind.',
      witness: null,
    };
  }

  const f = resolveDependencyFreshness(dep, fmap);

  // No freshness row at all = the data has never (recently) been seen = blind by silence.
  if (f.last == null) {
    const deadDep =
      pickDeadDependency(dep) || (dep.sourcetypes[0] ? `sourcetype=${dep.sourcetypes[0]}` : 'dependency');
    return {
      state: 'blind',
      last: null,
      ageSeconds: null,
      window,
      deadDependency: deadDep,
      depKey: dep.sourcetypes[0] || dep.indexes[0] || null,
      reason: `No data has arrived for ${deadDep} in the probe window — it cannot fire.`,
      witness: 'absence of freshness row',
    };
  }

  const age = nowSec - f.last;
  let state = 'healthy';
  if (age > window) state = 'blind';
  else if (age > agingFactor * window) state = 'aging';

  return {
    state,
    last: f.last,
    ageSeconds: age,
    window,
    depKey: f.key,
    deadDependency:
      state === 'healthy' ? null : keyToDeadDependency(f.key, dep),
    witness: f.witness,
    reason:
      state === 'blind'
        ? `Last data ${humanAge(age)} ago > ${humanAge(window)} window — cannot have fired in-window.`
        : state === 'aging'
        ? `Last data ${humanAge(age)} ago, past ${Math.round(agingFactor * 100)}% of its ${humanAge(
            window
          )} window — about to go blind.`
        : `Last data ${humanAge(age)} ago, well within its ${humanAge(window)} window.`,
  };
}

function pickDeadDependency(dep) {
  if (dep.indexes[0] && dep.sourcetypes[0]) return `sourcetype=${dep.sourcetypes[0]}`;
  if (dep.sourcetypes[0]) return `sourcetype=${dep.sourcetypes[0]}`;
  if (dep.indexes[0]) return `index=${dep.indexes[0]}`;
  return null;
}

function keyToDeadDependency(key, dep) {
  if (!key) return pickDeadDependency(dep);
  if (key.includes('|')) {
    const [, st] = key.split('|');
    return st ? `sourcetype=${st}` : `index=${key.split('|')[0]}`;
  }
  if (dep.sourcetypes.includes(key)) return `sourcetype=${key}`;
  if (dep.indexes.includes(key)) return `index=${key}`;
  return `sourcetype=${key}`;
}

export function humanAge(sec) {
  if (sec == null) return 'never';
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtTimestamp(epochSec) {
  if (epochSec == null) return '—';
  const d = new Date(epochSec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}
