'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '../components/store';
import ConnectedPill from '../components/ConnectedPill';
import { highlightSpl, humanAge } from '../components/format';

const STEPS = [
  { key: 'enumerate', name: 'Enumerate saved searches', tag: 'splunk.list_saved_searches', cls: '', note: 'GET /services/saved/searches — raw SPL, cron, window, actions for every alert.' },
  { key: 'parse', name: 'Parse dependencies', tag: 'vertex.gemini', cls: 'gem', note: 'Gemini reads each SPL and emits {index, sourcetype, source, window}. Regex is the floor; Gemini is the accelerator — it never decides health.' },
  { key: 'freshness', name: 'Freshness sweep', tag: 'splunk.search', cls: '', note: '| tstats latest(_time) by index, sourcetype  +  | metadata type=sourcetypes — one pass, the real last-reporting time of every source.' },
  { key: 'compute', name: 'Compute the blind set', tag: 'arithmetic', cls: '', note: 'now − last(dependency) > detection.window ⇒ BLIND. Proof-by-silence — never a model verdict.' },
  { key: 'grade', name: 'Grade exposure', tag: 'foundation-sec', cls: 'fnd', note: 'Each blind detection scored for technique class + severity (heuristic fallback if the Hosted Model is not installed).' },
];

export default function RunPage() {
  const { run, doRun, opts } = useStore();
  const router = useRouter();
  const [phase, setPhase] = useState(-1); // index of currently-running step; STEPS.length = done
  const [result, setResult] = useState(run);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAgent() {
    setPhase(0);
    // Animate steps forward while the real request runs; the real result lands when it lands.
    let p = 0;
    const ticker = setInterval(() => {
      p = Math.min(p + 1, STEPS.length - 1);
      setPhase(p);
    }, 700);
    try {
      const j = await doRun();
      setResult(j);
    } catch {
      /* error surfaced in store */
    } finally {
      clearInterval(ticker);
      setPhase(STEPS.length);
    }
  }

  const timings = result?.timings || {};
  const done = phase >= STEPS.length;

  // dependency tiles from the result
  const depTiles = [];
  if (result) {
    const seen = new Set();
    for (const d of result.detections) {
      for (const st of d.dependencies.sourcetypes) {
        if (seen.has(st)) continue;
        seen.add(st);
        depTiles.push({ sourcetype: st, state: d.health.state, age: d.health.ageSeconds, last: d.health.last });
      }
    }
  }

  function stepLatency(key) {
    if (key === 'compute') return timings.freshness != null ? 0 : null; // arithmetic is instantaneous
    return timings[key];
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Backstop Run</h1>
          <div className="sub">
            The agent works live: enumerate, parse each detection&apos;s data lifeline, then one
            freshness sweep resolves every lifeline. Real tool tags, real measured latency.
          </div>
        </div>
        <div className="head-tools">
          <ConnectedPill />
        </div>
      </div>

      {result && (
        <div className="kpis">
          <div className="kpi">
            <div className="k-val num">{result.counts.total}</div>
            <div className="k-lab">Detections</div>
          </div>
          <div className="kpi teal">
            <div className="k-val num">{result.distinctDependencies}</div>
            <div className="k-lab">Data dependencies</div>
          </div>
          <div className="kpi amber">
            <div className="k-val num">
              {(((timings.login || 0) + (timings.enumerate || 0) + (timings.parse || 0) + (timings.freshness || 0) + (timings.grade || 0)) / 1000).toFixed(2)}s
            </div>
            <div className="k-lab">One pass, total</div>
          </div>
          <div className="kpi">
            <div className="k-val num" style={{ textTransform: 'lowercase' }}>
              {result.meta.transport === 'mcp-server' ? 'MCP' : 'REST'}
            </div>
            <div className="k-lab">Transport in force</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 28, alignItems: 'start' }} className="run-grid">
        <div className="timeline">
          {STEPS.map((s, i) => {
            const state = done || i < phase ? 'done' : i === phase ? 'run' : '';
            const lat = stepLatency(s.key);
            return (
              <div className="tl-step" key={s.key}>
                <div className="tl-rail">
                  <div className={`tl-node ${state}`}>{state === 'done' ? '✓' : state === 'run' ? '' : i + 1}</div>
                  {i < STEPS.length - 1 && <div className="tl-line" />}
                </div>
                <div className="tl-body">
                  <div className="tl-name">
                    {s.name}
                    <span className={`tl-tag ${s.cls}`}>{s.key === 'parse' && !opts.useGemini ? 'regex-only' : s.tag}</span>
                    {state === 'run' && <span className="spinner" />}
                    {(done || i < phase) && lat != null && <span className="tl-lat">{lat === 0 ? '<1ms' : lat + 'ms'}</span>}
                  </div>
                  <div className="tl-note">{s.note}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <div className="section-label" style={{ marginTop: 0 }}>
            Live probe
          </div>
          <div
            className="spl-block"
            dangerouslySetInnerHTML={{
              __html: highlightSpl('| tstats latest(_time) as last by index, sourcetype'),
            }}
          />
          <div className="section-label">Dependency lifelines</div>
          {depTiles.length === 0 ? (
            <div className="note">Resolving lifelines…</div>
          ) : (
            <div className="dep-sweep">
              {depTiles.map((t) => (
                <div className="dep-tile" key={t.sourcetype}>
                  <span className={`light ${t.state}`}>
                    <span className="lamp" />
                  </span>
                  <span className="dt-name" title={t.sourcetype}>
                    {t.sourcetype}
                  </span>
                  <span className="dt-age">{t.last != null ? humanAge(t.age) : 'silent'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {done && result && (
        <div style={{ marginTop: 30, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn primary" onClick={() => router.push('/blind')}>
            See the blind wall →
          </button>
          <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
            <b className="num">{result.counts.blind}</b> blind · <b className="num">{result.counts.aging}</b> aging ·{' '}
            <b className="num">{result.counts.healthy}</b> healthy
          </span>
        </div>
      )}

      <style jsx>{`
        @media (max-width: 1000px) {
          .run-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
