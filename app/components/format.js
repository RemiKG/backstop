// Client-side display helpers (mirror of lib/health.mjs presentation utilities).

export function humanAge(sec) {
  if (sec == null) return 'never';
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtTimestamp(epochSec) {
  if (epochSec == null) return '—';
  const d = new Date(epochSec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

export function stateLabel(state) {
  return { healthy: 'HEALTHY', aging: 'AGING', blind: 'BLIND', unknown: 'UNKNOWN', meta: 'META' }[state] || state.toUpperCase();
}

// Lightweight SPL syntax highlight for the dark probe block. Tokenise first, then wrap —
// so the injected <span> markup is never re-matched/corrupted by later passes.
const SPL_FNS = new Set(['tstats', 'metadata', 'stats', 'latest', 'earliest', 'count', 'where', 'eval', 'table', 'bin', 'dc', 'outputlookup', 'inputlookup', 'rest', 'search', 'as', 'by']);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightSpl(spl) {
  // Split on pipes, keep them; within each segment highlight functions and key=value.
  const parts = String(spl).split('|');
  const out = parts.map((seg, i) => {
    let h = esc(seg)
      // key=value -> highlight the key
      .replace(/\b([a-zA-Z_][\w.]*)\s*=/g, '<span class="kv">$1</span>=')
      // bare function/keyword tokens
      .replace(/\b([a-zA-Z_]+)\b/g, (m, w) => (SPL_FNS.has(w) ? `<span class="fn">${w}</span>` : m));
    const pipe = i > 0 ? '<span class="pipe">|</span>' : '';
    return pipe + h;
  });
  return out.join('');
}
