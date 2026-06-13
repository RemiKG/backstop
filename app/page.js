'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from './components/store';
import ConnectedPill from './components/ConnectedPill';
import DetectionCard from './components/DetectionCard';

export default function EstatePage() {
  const { run, doRun, running, error } = useStore();
  const router = useRouter();

  useEffect(() => {
    if (!run && !running) doRun().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detections = run?.detections || [];
  const enumerated = run?.counts?.total ?? (running ? '…' : 0);
  const enumMs = run?.timings ? ((run.timings.login || 0) + (run.timings.enumerate || 0)) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Estate</h1>
          <div className="sub">
            Every saved-search detection enumerated live from the connected Splunk over the
            443 web-REST proxy. The honest before — a wall of detections that all <i>look</i> fine.
          </div>
        </div>
        <div className="head-tools">
          <ConnectedPill />
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-val num">{enumerated}</div>
          <div className="k-lab">Detections enumerated</div>
        </div>
        <div className="kpi">
          <div className="k-val num">{run ? detections.filter((d) => d.search).length : '…'}</div>
          <div className="k-lab">SPL pulled</div>
        </div>
        <div className="kpi amber">
          <div className="k-val num">{enumMs != null ? (enumMs / 1000).toFixed(2) + 's' : '…'}</div>
          <div className="k-lab">Enumerate time</div>
        </div>
        <div className="kpi teal">
          <div className="k-val num">{run ? run.distinctDependencies : '…'}</div>
          <div className="k-lab">Distinct (index, sourcetype) deps</div>
        </div>
      </div>

      {error && (
        <div className="note" style={{ borderColor: '#ecd3a6', marginBottom: 20 }}>
          <b>Connection issue:</b> {error}. Check Settings — Splunk credentials are read from
          server env only.
        </div>
      )}

      {!run && running && (
        <div className="empty">
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          <div className="e-big">Reading the detection estate…</div>
          GET /services/saved/searches over the 443 proxy
        </div>
      )}

      {run && detections.length === 0 && (
        <div className="empty">
          <div className="e-big">No sample detections found.</div>
          Run <span className="mono">npm run seed</span> to plant the labelled SAMPLE estate, or
          turn off SAMPLE in Settings to grade your own live saved searches.
        </div>
      )}

      {detections.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="section-label" style={{ margin: 0 }}>
              The detection estate
            </div>
            <button className="btn primary sm" onClick={() => router.push('/run')}>
              Backstop your detections →
            </button>
          </div>
          <div className="grid">
            {detections.map((d) => (
              <DetectionCard key={d.name} d={d} showHealth={false} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
