'use client';
import { useEffect, useState } from 'react';
import { useStore } from '../components/store';
import ConnectedPill from '../components/ConnectedPill';

export default function HandbackPage() {
  const { run, opts } = useStore();
  const [data, setData] = useState(null);
  const [writing, setWriting] = useState(false);
  const [canvas, setCanvas] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch('/api/handback')
      .then((r) => r.json())
      .then((j) => !j.error && j.rows?.length && setData(j))
      .catch(() => {});
  }, []);

  async function writeBack() {
    setWriting(true);
    setErr(null);
    try {
      const r = await fetch('/api/handback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gemini: opts.useGemini, all: !opts.sampleOnly }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setData(j);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setWriting(false);
    }
  }

  const rows = data?.rows || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hand-back</h1>
          <div className="sub">
            The coverage-gap map written back into your <i>own</i> Splunk as a lookup, plus a
            scheduled Backstop saved search — so the meta-monitoring survives outside the app. The
            app keeps no copy of your log data, only the gap-map.
          </div>
        </div>
        <div className="head-tools">
          <ConnectedPill />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={writeBack} disabled={writing}>
          {writing ? (
            <>
              <span className="spinner" /> writing lookup + scheduling…
            </>
          ) : (
            'Write coverage-gap back to Splunk'
          )}
        </button>
        <button className="btn" onClick={() => setCanvas((v) => !v)}>
          {canvas ? 'Hide' : 'View'} AI Canvas briefing
        </button>
      </div>

      {err && (
        <div className="note" style={{ borderColor: '#ecd3a6', marginBottom: 18 }}>
          <b>Write issue:</b> {err}
        </div>
      )}

      {data?.scheduledSearch && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <div className="c-title">Scheduled: {data.scheduledSearch.name}</div>
              <div className="c-desc">
                The one alert that fires when an alert can&apos;t. Runs on Splunk&apos;s own
                scheduler and emails when any data source a detection depends on goes silent.
              </div>
              <div className="chips">
                <span className="chip mono">cron {data.scheduledSearch.cron}</span>
                <span className="chip mono">action {data.scheduledSearch.action}</span>
                <span className={`chip ${data.scheduledSearch.installed ? 'st' : ''}`}>
                  {data.scheduledSearch.installed ? 'installed' : 'not installed'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="section-label" style={{ marginTop: 0 }}>
        Coverage-gap lookup · <span className="mono">{data?.lookup || 'backstop_coverage'}.csv</span>
        {data?.written != null && (
          <span style={{ color: 'var(--ink-faint)', fontWeight: 600 }}> · {data.written} rows written</span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="note">
          No lookup written yet. Click <b>Write coverage-gap back to Splunk</b> — it computes the
          current live state and persists it as <span className="mono">backstop_coverage.csv</span>{' '}
          in your own Splunk via <span className="mono">| outputlookup</span>.
        </div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Detection</th>
              <th>Dependency</th>
              <th>State</th>
              <th>Last seen</th>
              <th>Exposure</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{(r.detection || '').replace(/^Backstop Demo — /, '')}</td>
                <td className="mono">{r.dependency || '—'}</td>
                <td>
                  <span className={`light ${r.state}`} style={{ fontSize: 11 }}>
                    <span className="lamp" />
                    {(r.state || '').toUpperCase()}
                  </span>
                </td>
                <td className="mono">{r.last_seen}{r.age ? ` (${r.age} ago)` : ''}</td>
                <td className="mono">{r.exposure || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canvas && <Canvas rows={rows} run={run} sample={opts.sampleOnly} />}
    </>
  );
}

function Canvas({ rows, run, sample }) {
  const cells = rows.length
    ? rows.map((r) => ({ name: (r.detection || '').replace(/^Backstop Demo — /, ''), state: r.state, ts: r.last_seen }))
    : (run?.detections || []).map((d) => ({
        name: d.name.replace(/^Backstop Demo — /, ''),
        state: d.health.state,
        ts: d.health.last ? new Date(d.health.last * 1000).toISOString().slice(0, 16).replace('T', ' ') : 'never',
      }));
  return (
    <div className="canvas-wall" style={{ marginTop: 24 }}>
      <h2>Backstop — Coverage Briefing {sample && <span style={{ color: 'var(--accent)', fontSize: 13 }}>· SAMPLE</span>}</h2>
      <div className="cw-sub">
        Every detection, its health light, its last-data timestamp. The SOC&apos;s first &quot;is my
        coverage even real?&quot; screen. {sample && 'Stamped SAMPLE throughout — the source detections are seeded, the mechanic is real.'}
      </div>
      <div className="canvas-grid">
        {cells.map((c, i) => (
          <div key={i} className={`cw-cell ${c.state}`}>
            <div className="cw-name">{c.name}</div>
            <div className="cw-ts">
              {c.state === 'blind' ? 'BLIND · ' : c.state === 'aging' ? 'AGING · ' : ''}
              {c.ts}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
