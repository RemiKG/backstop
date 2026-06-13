'use client';
import { useEffect, useState } from 'react';
import { useStore } from './store';
import { fmtTimestamp, humanAge, highlightSpl } from './format';

export default function ProofDrawer() {
  const { proof, setProof } = useStore();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!proof) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setData(null);
    const q = new URLSearchParams({
      index: proof.index || '',
      sourcetype: proof.sourcetype || '',
    });
    fetch('/api/proof?' + q.toString())
      .then((r) => r.json())
      .then((j) => {
        if (alive) setData(j);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [proof]);

  const open = !!proof;
  const h = proof?.health;
  const row = data?.rows?.[0];
  const last = row ? Math.floor(Number(row.last)) : h?.last ?? null;
  const now = Math.floor(Date.now() / 1000);
  const age = last != null ? now - last : null;
  const win = h?.window ?? proof?.windowSeconds ?? null;

  return (
    <>
      <div className={`drawer-scrim ${open ? 'open' : ''}`} onClick={() => setProof(null)} />
      <div className={`drawer ${open ? 'open' : ''}`}>
        {open && (
          <>
            <button className="x-close" onClick={() => setProof(null)} aria-label="Close">
              ✕
            </button>
            <h2>Proof</h2>
            <div className="d-sub">
              The literal SPL behind this verdict. Nothing hidden — re-measure the same
              silence in your own search bar, on your own clock.
            </div>

            <div className="d-label">{proof.title || 'Dependency'}</div>
            <div className="row-out">
              {proof.index && (
                <div>
                  <span style={{ color: 'var(--ink-faint)' }}>index</span> = {proof.index}
                </div>
              )}
              {proof.sourcetype && (
                <div>
                  <span style={{ color: 'var(--ink-faint)' }}>sourcetype</span> = {proof.sourcetype}
                </div>
              )}
            </div>

            <div className="d-label">The query that produced the verdict</div>
            {loading && !data ? (
              <div className="spl-block">
                <span className="spinner" style={{ display: 'inline-block' }} /> running on live Splunk…
              </div>
            ) : (
              <div
                className="spl-block"
                dangerouslySetInnerHTML={{ __html: highlightSpl(data?.spl || '| tstats latest(_time) as last by index, sourcetype') }}
              />
            )}

            <div className="d-label">Returned row (live)</div>
            <div className="row-out">
              {row ? (
                <>
                  <div>index = {row.index || proof.index || '—'}</div>
                  <div>sourcetype = {row.sourcetype || proof.sourcetype || '—'}</div>
                  <div>
                    last = <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{fmtTimestamp(last)}</span>{' '}
                    <span style={{ color: 'var(--ink-faint)' }}>({last})</span>
                  </div>
                  {row.count != null && <div>count = {row.count}</div>}
                </>
              ) : loading ? (
                <span style={{ color: 'var(--ink-faint)' }}>measuring…</span>
              ) : (
                <span style={{ color: 'var(--ink-faint)' }}>
                  no row — this data source has never (recently) reported. Absence IS the silence.
                </span>
              )}
            </div>

            <div className="d-label">The arithmetic (proof-by-silence)</div>
            <div className="arith">
              <div>now − last = {age != null ? `${humanAge(age)} (${age}s)` : '∞ (never seen)'}</div>
              {win != null && <div>detection window = {humanAge(win)} ({win}s)</div>}
              {win != null && (
                <div style={{ marginTop: 8 }}>
                  {age == null || age > win ? 'now − last' : 'now − last'} {age != null && win != null ? (age > win ? '>' : '≤') : ''}{' '}
                  window ⇒{' '}
                  <span className={`res ${h?.state || (age != null && win != null && age > win ? 'blind' : 'healthy')}`}>
                    {(h?.state || (age == null || (win != null && age > win) ? 'BLIND' : 'HEALTHY')).toUpperCase()}
                  </span>
                </div>
              )}
            </div>

            {data?.deepLink && (
              <a className="btn amber" href={data.deepLink} target="_blank" rel="noreferrer" style={{ marginTop: 22, width: '100%', justifyContent: 'center' }}>
                Run this in Search ↗
              </a>
            )}
            <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 12, lineHeight: 1.5 }}>
              Opens the exact query in your own Splunk search app. The verdict is arithmetic
              on this timestamp — you can&apos;t fake a silence the judge re-measures.
            </div>
          </>
        )}
      </div>
    </>
  );
}
