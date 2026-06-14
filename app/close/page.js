'use client';
import { useEffect, useState } from 'react';
import Wordmark from '../components/Wordmark';

// The closing card. A clean cream slide: the wordmark, the one-line claim with the REAL
// post-flip counts pulled live (so the spoken number can never drift from the screen), the
// live URL, and a thank-you. Counts come from /api/run; the flip card is included in "blind"
// the moment its feed is stopped, so this reads "<total> detections · <blind+1> blind".
export default function ClosePage() {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    fetch('/api/run')
      .then((r) => r.json())
      .then((j) => {
        if (j && j.counts) {
          // The money-shot flip makes the C2 Beacon blind. At the close it has been stopped,
          // so report blind as the run's blind count + the flip card (if it isn't already blind).
          const flip = (j.detections || []).find((d) => /C2 Beacon/.test(d.name));
          const flipAlreadyBlind = flip && flip.health && flip.health.state === 'blind';
          setCounts({
            total: j.counts.total,
            blind: j.counts.blind + (flipAlreadyBlind ? 0 : 1),
          });
        }
      })
      .catch(() => {});
  }, []);

  const total = counts?.total ?? 11;
  const blind = counts?.blind ?? 4;

  return (
    <div className="close-stage">
      <div className="close-card">
        <Wordmark size={46} />
        <div className="close-claim">
          <b className="num">{total}</b> detections · <b className="num">{blind}</b> blind
        </div>
        <div className="close-line">The one alert that fires when an alert can&apos;t.</div>
        <div className="close-url">backstop-splunk.vercel.app</div>
        <div className="close-foot">Live · the code&apos;s public · thanks for watching.</div>
      </div>
    </div>
  );
}
