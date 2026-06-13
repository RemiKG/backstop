'use client';
import { useStore } from './store';
import StatusLight from './StatusLight';
import { fmtTimestamp, humanAge } from './format';

export default function DetectionCard({ d, showHealth = true }) {
  const { setProof } = useStore();
  const dep = d.dependencies || {};
  const h = d.health;

  const openProof = () => {
    setProof({
      title: d.name,
      index: dep.indexes?.[0] || '',
      sourcetype: dep.sourcetypes?.[0] || '',
      health: h,
      windowSeconds: dep.windowSeconds,
    });
  };

  return (
    <div className="card">
      <div className="c-top">
        <div className="c-title">{d.name.replace(/^Backstop Demo — /, '')}</div>
        {showHealth && h && (
          <button
            onClick={openProof}
            style={{ background: 'none', border: 'none', padding: 0 }}
            title="Show the proof"
          >
            <StatusLight state={h.state} pulse={h.state === 'healthy'} />
          </button>
        )}
      </div>
      {d.description && <div className="c-desc">{d.description}</div>}

      <div className="chips">
        {(dep.indexes || []).map((i) => (
          <span key={'i' + i} className="chip idx">
            index={i}
          </span>
        ))}
        {(dep.sourcetypes || []).map((s) => (
          <span key={'s' + s} className="chip st">
            sourcetype={s}
          </span>
        ))}
        {dep.dependencyUnknown && <span className="chip">dependency unknown</span>}
        {dep.metaSearch && <span className="chip">meta-search</span>}
      </div>

      <div className="meta-row">
        <div className="m">
          cron
          <b>{d.cron || '— manual'}</b>
        </div>
        <div className="m">
          window
          <b>{d.earliest || '-24h'}</b>
        </div>
        {showHealth && h && h.last != null && (
          <div className="m">
            last data
            <b style={{ color: h.state === 'healthy' ? 'var(--teal)' : 'var(--accent)' }}>
              {humanAge(h.ageSeconds)} ago
            </b>
          </div>
        )}
        {showHealth && h && h.last == null && (h.state === 'blind') && (
          <div className="m">
            last data
            <b style={{ color: 'var(--accent)' }}>never</b>
          </div>
        )}
      </div>
    </div>
  );
}
