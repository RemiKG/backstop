'use client';
import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import StatusLight from './StatusLight';
import { fmtTimestamp, humanAge } from './format';

// The money shot, in one card. While "feed running" we push a heartbeat every ~20s that
// keeps the flip detection genuinely GREEN (real fresh _time). Hit "Stop the feed" and the
// heartbeat stops; we poll the real last(_time) and the same card flips teal->hollow the
// moment now-last crosses the detection's real -2m window. Nothing moves but the light and
// the timestamp — and you can re-derive it in your own search bar.

const POLL_MS = 2500;
const HEARTBEAT_MS = 20000;

export default function LiveFlip() {
  const { setProof } = useStore();
  const [state, setState] = useState(null); // {state,last,age,windowSeconds,...}
  const [feedRunning, setFeedRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const heartbeatRef = useRef(null);
  const pollRef = useRef(null);
  const [tick, setTick] = useState(0); // forces countdown re-render

  // initial state
  useEffect(() => {
    refresh();
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      clearInterval(t);
      stopTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTimers() {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    heartbeatRef.current = null;
    pollRef.current = null;
  }

  async function refresh() {
    try {
      const r = await fetch('/api/feed');
      const j = await r.json();
      if (!j.error) setState(j);
    } catch {}
  }

  async function beat() {
    try {
      const r = await fetch('/api/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const j = await r.json();
      if (!j.error) setState(j);
    } catch {}
  }

  async function startFeed() {
    setBusy(true);
    await beat(); // immediate fresh event -> green
    setBusy(false);
    setFeedRunning(true);
    heartbeatRef.current = setInterval(beat, HEARTBEAT_MS);
    // light polling so the age counter stays live
    pollRef.current = setInterval(refresh, POLL_MS);
  }

  function stopFeed() {
    setFeedRunning(false);
    // stop the heartbeat — the feed is now silent. Keep polling so we CATCH the flip.
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    if (!pollRef.current) pollRef.current = setInterval(refresh, POLL_MS);
    refresh();
  }

  // derive a live age using wall clock between polls
  const now = Math.floor(Date.now() / 1000);
  void tick;
  const last = state?.last ?? null;
  const liveAge = last != null ? now - last : null;
  const win = state?.windowSeconds ?? 120;
  let liveState = state?.state || 'blind';
  if (last != null) liveState = liveAge > win ? 'blind' : liveAge > win * 0.5 ? 'aging' : 'healthy';
  const secsToBlind = last != null ? Math.max(0, win - liveAge) : 0;

  const title = 'C2 Beacon — Periodic Egress';

  return (
    <div style={{ marginBottom: 8 }}>
      <div className="section-label" style={{ marginTop: 0 }}>
        Live flip — kill a feed, watch a green light go blind
      </div>
      <div className="flip-stage">
        <div className={`flip-card ${liveState}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div>
              <div className="fc-title">{title}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6 }}>
                depends on <span className="mono">sourcetype=paloalto_traffic</span> · window{' '}
                <span className="mono">-2m</span>
              </div>
            </div>
            <button
              onClick={() =>
                setProof({
                  title,
                  index: state?.index || 'backstop_demo',
                  sourcetype: state?.sourcetype || 'paloalto_traffic',
                  health: { state: liveState, last, ageSeconds: liveAge, window: win },
                  windowSeconds: win,
                })
              }
              style={{ background: 'none', border: 'none', padding: 0 }}
            >
              <StatusLight state={liveState} pulse={liveState === 'healthy' && feedRunning} />
            </button>
          </div>

          <div className="fc-stamp">
            {liveState === 'blind' && last != null ? (
              <>last row it will ever see: {fmtTimestamp(last)}</>
            ) : last != null ? (
              <>last data: {humanAge(liveAge)} ago · {fmtTimestamp(last)}</>
            ) : (
              <>no data yet — start the feed to bring it alive</>
            )}
          </div>

          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div className="flip-controls">
              {!feedRunning ? (
                <button className="btn primary" onClick={startFeed} disabled={busy}>
                  {busy ? 'starting…' : last == null || liveState !== 'healthy' ? 'Start the feed' : 'Restart the feed'}
                </button>
              ) : (
                <button className="btn amber" onClick={stopFeed}>
                  Stop the feed
                </button>
              )}
            </div>
            {feedRunning ? (
              <span className="live-dot">
                <span className="ld" /> feed live · heartbeat every 20s
              </span>
            ) : last != null && liveState !== 'blind' ? (
              <span className="countdown">
                blind in <b className="num">{secsToBlind}s</b> unless the feed resumes
              </span>
            ) : (
              <span className="live-dot stopped">
                <span className="ld" /> feed silent
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 10, maxWidth: 620, lineHeight: 1.55 }}>
        The feed runs on a real heartbeat into <span className="mono">backstop_demo</span>. Stop it
        and the detection flips because <span className="mono">now − last(_time)</span> crosses its
        real <span className="mono">-2m</span> window — not because anything was asserted. Click the
        light for the query; re-measure it in your own search bar.
      </div>
    </div>
  );
}
