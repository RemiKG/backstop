// The Backstop agent. Orchestrates the whole run on live Splunk data:
//   1. Enumerate the detection estate          (splunk.list_saved_searches)
//   2. Parse each detection's data dependencies (Gemini accelerator + regex)
//   3. One freshness sweep                      (| tstats latest(_time) + | metadata)
//   4. Compute the blind set                    (arithmetic — proof-by-silence)
//   5. Grade exposure of the blind ones         (Foundation-sec seam / heuristic)
//
// Every health verdict is arithmetic on a real latest(_time). The agent never asserts
// health; Gemini only accelerates step 2; the exposure grade in step 5 is advisory and
// kept separate from the blind/healthy FACT.

import { SplunkClient } from './splunk.mjs';
import { SplunkTools } from './tools.mjs';
import { parseDependencies } from './parse.mjs';
import { buildFreshnessMap, computeHealth, DEFAULT_AGING_FACTOR } from './health.mjs';
import { gradeExposure, foundationSecConfigured } from './exposure.mjs';
import { geminiConfigured, VERTEX_META } from './gemini.mjs';

const SAMPLE_APP = 'search';
const SAMPLE_PREFIX = 'Backstop Demo —';
const SAMPLE_INDEX = process.env.BACKSTOP_DEMO_INDEX || 'backstop_demo';

// Decide whether a saved search is a "detection" worth grading. We exclude the stock
// internal/admin housekeeping searches (|rest, _internal license/orphan etc.) by default,
// but keep them visible when sampleOnly is false so the estate is honest.
function isLikelyDetection(d) {
  if (d.disabled) return false;
  const s = (d.search || '').toLowerCase();
  if (!s) return false;
  return true;
}

function isSample(d) {
  return d.name.startsWith(SAMPLE_PREFIX);
}

export async function runBackstop({ useGemini = true, agingFactor = DEFAULT_AGING_FACTOR, sampleOnly = true } = {}) {
  const timings = {};
  const t = (k, fn) => {
    const s = Date.now();
    return Promise.resolve(fn()).then((r) => {
      timings[k] = Date.now() - s;
      return r;
    });
  };

  const sp = new SplunkClient();
  await t('login', () => sp.login());
  const tools = await new SplunkTools(sp).init();

  // 1. Enumerate
  let estate = await t('enumerate', () => tools.list_saved_searches());
  estate = estate.filter(isLikelyDetection);
  if (sampleOnly) {
    const samples = estate.filter(isSample);
    if (samples.length) estate = samples;
  }

  // 2. Parse dependencies (Gemini accelerator + regex) — batched concurrency
  const useG = useGemini && geminiConfigured();
  const deps = await t('parse', async () => {
    const out = [];
    const CONC = 6;
    for (let i = 0; i < estate.length; i += CONC) {
      const slice = estate.slice(i, i + CONC);
      const r = await Promise.all(slice.map((d) => parseDependencies(d, { useGemini: useG })));
      out.push(...r);
    }
    return out;
  });

  // 3. One freshness sweep
  const sweep = await t('freshness', () => tools.freshness_sweep({ earliest: '-30d', latest: 'now' }));
  const fmap = buildFreshnessMap(sweep.tstats, sweep.metadata);

  // distinct (index, sourcetype) dependencies across the estate
  const distinctDeps = new Set();
  for (const d of deps) {
    const idxs = d.indexes.length ? d.indexes : [''];
    for (const idx of idxs) for (const st of d.sourcetypes) distinctDeps.add(`${idx}|${st}`);
  }

  // 4. Compute health (arithmetic)
  const nowSec = Math.floor(Date.now() / 1000);
  const detections = estate.map((d, i) => {
    const dep = deps[i];
    const health = computeHealth(d, dep, fmap, { nowSec, agingFactor });
    return {
      name: d.name,
      app: d.app,
      description: d.description,
      search: d.search,
      cron: d.cron,
      earliest: d.earliest,
      latest: d.latest,
      actions: d.actions,
      isScheduled: d.isScheduled,
      isSample: isSample(d),
      dependencies: {
        indexes: dep.indexes,
        sourcetypes: dep.sourcetypes,
        sources: dep.sources,
        windowSeconds: dep.windowSeconds,
        parsedBy: dep.parsedBy,
        dependencyUnknown: dep.dependencyUnknown,
        metaSearch: dep.metaSearch,
      },
      health,
    };
  });

  // 5. Grade exposure for blind + aging detections (advisory)
  await t('grade', async () => {
    await Promise.all(
      detections
        .filter((d) => d.health.state === 'blind' || d.health.state === 'aging')
        .map(async (d) => {
          d.exposure = await gradeExposure({
            name: d.name,
            description: d.description,
            search: d.search,
            cron: d.cron,
            actions: d.actions,
          });
        })
    );
  });

  const counts = tally(detections);
  const stateCount = detections.filter((d) => ['healthy', 'aging', 'blind'].includes(d.health.state)).length;
  const withRealTimestamp = detections.filter(
    (d) => ['healthy', 'aging'].includes(d.health.state) || (d.health.state === 'blind' && d.health.last != null)
  ).length;

  return {
    meta: {
      transport: tools.transport,
      mcpAvailable: tools.mcpAvailable,
      geminiUsed: useG,
      gemini: useG ? VERTEX_META : null,
      foundationSec: foundationSecConfigured(),
      exposureMode: detections.find((d) => d.exposure)?.exposure?.mode || (foundationSecConfigured() ? 'foundation-sec' : 'heuristic'),
      agingFactor,
      sampleOnly,
      sampleIndex: SAMPLE_INDEX,
      nowSec,
      // The flex: every graded health state is backed by a real freshness probe.
      healthStates: stateCount,
      statesWithoutTimestamp: counts.blind > 0 ? detections.filter((d) => d.health.state === 'blind' && d.health.last == null).length : 0,
    },
    timings,
    counts,
    distinctDependencies: distinctDeps.size,
    detections,
  };
}

function tally(detections) {
  const c = { total: detections.length, healthy: 0, aging: 0, blind: 0, unknown: 0, meta: 0 };
  for (const d of detections) {
    if (c[d.health.state] != null) c[d.health.state]++;
  }
  return c;
}
