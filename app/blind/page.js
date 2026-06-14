'use client';
import { useEffect } from 'react';
import { useStore } from '../components/store';
import ConnectedPill from '../components/ConnectedPill';
import StatusLight from '../components/StatusLight';
import LiveFlip from '../components/LiveFlip';
import { fmtTimestamp, humanAge } from '../components/format';

export default function BlindWallPage() {
  const { run, doRun, running, setProof } = useStore();

  useEffect(() => {
    if (!run && !running) doRun().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detections = run?.detections || [];
  const c = run?.counts || { total: 0, healthy: 0, aging: 0, blind: 0 };
  const blind = detections
    .filter((d) => d.health.state === 'blind')
    .sort((a, b) => sev(b) - sev(a));
  const aging = detections.filter((d) => d.health.state === 'aging').sort((a, b) => sev(b) - sev(a));

  const openProof = (d) =>
    setProof({
      title: d.name,
      index: d.dependencies.indexes?.[0] || '',
      sourcetype: d.dependencies.sourcetypes?.[0] || '',
      health: d.health,
      windowSeconds: d.dependencies.windowSeconds,
    });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>The Blind Wall</h1>
          <div className="sub">
            The detections that <i>cannot fire</i> — each with its dead dependency, its real
            last-data timestamp, and an exposure grade. To a &quot;no alerts&quot; dashboard these look
            identical to healthy. Backstop is the difference between the two silences.
          </div>
        </div>
        <div className="head-tools">
          <ConnectedPill />
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-val num">{c.total}</div>
          <div className="k-lab">Detections</div>
        </div>
        <div className="kpi teal">
          <div className="k-val num">{c.healthy}</div>
          <div className="k-lab">Healthy</div>
        </div>
        <div className="kpi">
          <div className="k-val num" style={{ color: 'var(--hollow)' }}>
            {c.blind}
          </div>
          <div className="k-lab">Blind</div>
        </div>
        <div className="kpi amber">
          <div className="k-val num">{c.aging}</div>
          <div className="k-lab">Aging</div>
        </div>
        <div className="kpi flex">
          <div className="k-val num">{run ? run.meta.statesWithoutTimestamp : '…'}</div>
          <div className="k-lab">Health states without a real timestamp</div>
        </div>
      </div>

      <LiveFlip />

      {blind.length > 0 && (
        <>
          <div className="section-label">Blind — lifted to the top, ranked by exposure</div>
          {blind.map((d) => (
            <BlindCard key={d.name} d={d} onProof={() => openProof(d)} />
          ))}
        </>
      )}

      {aging.length > 0 && (
        <>
          <div className="section-label">Aging — about to go blind</div>
          {aging.map((d) => (
            <BlindCard key={d.name} d={d} onProof={() => openProof(d)} aging />
          ))}
        </>
      )}

      {run && blind.length === 0 && aging.length === 0 && (
        <div className="note">
          Every detection&apos;s lifeline is alive right now. Use the live flip above (or{' '}
          <span className="mono">npm run stop-feed</span>) to stop a feed and watch a green light go
          BLIND on a real timestamp.
        </div>
      )}
    </>
  );
}

function sev(d) {
  const r = { HIGH: 3, MED: 2, LOW: 1 };
  return r[d.exposure?.severity] || 0;
}

function BlindCard({ d, onProof, aging }) {
  const h = d.health;
  const exp = d.exposure;
  const high = exp?.severity === 'HIGH';
  return (
    <div className={`blind-card ${high ? 'high' : ''}`}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onProof} style={{ background: 'none', border: 'none', padding: 0 }}>
            <StatusLight state={h.state} />
          </button>
          <span className="bc-title">{d.name.replace(/^Backstop Demo — /, '')}</span>
        </div>
        {exp?.verdict && <div className="bc-verdict">{exp.verdict}</div>}
        <div className="bc-dep">
          <span className="dead-dep">{h.deadDependency || `sourcetype=${d.dependencies.sourcetypes[0] || '?'}`}</span>
          <span>last data</span>
          <span className="lastdata">
            {h.last != null ? `${humanAge(h.ageSeconds)} ago` : 'never'}
          </span>
          {h.last != null && (
            <span style={{ color: 'var(--ink-faint)' }}>· {fmtTimestamp(h.last)}</span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 9 }}>{h.reason}</div>
      </div>
      <div className="bc-right">
        {exp && (
          <div className={`exp ${exp.severity}`}>
            {exp.severity}
            <span className="etech">· {exp.technique}</span>
          </div>
        )}
        <button className="btn sm" onClick={onProof}>
          Proof ↗
        </button>
        {exp?.mode && (
          <span className={`badge-mode ${exp.mode === 'foundation-sec' ? 'real' : 'fallback'}`}>
            {exp.mode === 'foundation-sec' ? 'Foundation-sec' : 'heuristic'}
          </span>
        )}
      </div>
    </div>
  );
}
