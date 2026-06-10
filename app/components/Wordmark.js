// The wordmark with the traffic-light pair of o's: first a calm amber dot (watching),
// second a hollow ring (a detection gone dark). One letter carries the whole green->BLIND idea.
export default function Wordmark({ size = 25 }) {
  return (
    <div className="wordmark" style={{ fontSize: size }} aria-label="Backstop">
      <span>Backst</span>
      <span className="lit">
        <span className="dot-amber" title="watching" />
      </span>
      <span className="lit">
        <span className="dot-hollow" title="gone dark" />
      </span>
      <span>p</span>
    </div>
  );
}
