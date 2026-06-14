# Backstop

**37 detections. 4 are blind. Backstop is the one alert that fires when an alert can't.**

> An AI agent reads your real saved-search detections, works out the exact data each one
> needs to fire, then probes your live indexes to prove which detections have gone silently
> blind — and ranks the blind ones by the attack they were the only thing guarding.

Backstop is a Security-track app for **Splunk Cloud**. It watches the watchers. The mechanic
is small and the contract is the whole product: **a detection's health is computed from the
real last-seen timestamp of the data it actually depends on — not asserted by a model, and
re-derivable by you in your own search bar.** We call that contract **proof-by-silence**: a
green detection flips to BLIND the moment its data stops, stamped with the timestamp of the
last row it will ever see.

---

## The one money shot

Point Backstop at your own saved searches. It enumerates them, parses what data each one
needs, sweeps the real freshness of every data source, and proves which detections are
currently **BLIND** — each blind detection depends on a sourcetype that stopped reporting,
shown with its real last-data timestamp and graded for exposure. Then **stop a feed** and
watch a green detection flip to BLIND within seconds, stamped with its last `_time`.

A "no alerts" SOC dashboard can never show you that moment: to it, a blind detection and a
quiet-but-healthy detection look identical — both are silent. **Backstop is the difference
between the two silences.** And every state is re-derivable — paste the same
`| tstats latest(_time) by index, sourcetype` into your own search bar and read the same
timestamp.

---

## Architecture

A single **Next.js (App Router)** app. All Splunk and Gemini calls happen in server-side
API routes and library modules — **no secret ever reaches the browser**, and the client only
ever talks to its own relative `/api/*` routes (no hardcoded hosts or ports).

```
repo/
├─ app/
│  ├─ page.js              Estate    — the detection estate enumerated live (the "before")
│  ├─ run/page.js          Run       — agent timeline: enumerate → parse → sweep → compute → grade
│  ├─ blind/page.js        Blind Wall— MONEY SHOT: blind detections + the live flip card
│  ├─ handback/page.js     Hand-back — coverage-gap lookup + scheduled meta-detection + AI Canvas
│  ├─ settings/page.js     Settings  — connection, the blind arithmetic, agent/models, scheduling
│  ├─ components/          Sidebar, Wordmark, StatusLight, ProofDrawer, LiveFlip, store, …
│  └─ api/
│     ├─ run/              GET  — runs the whole agent, returns the graded estate
│     ├─ feed/             GET/POST — live-flip control (heartbeat / report frozen last-time)
│     ├─ handback/         GET/POST — write the coverage-gap lookup + schedule the meta-detection
│     ├─ proof/            GET  — the literal SPL behind a verdict + a Run-this-in-Search deep link
│     └─ config/           GET  — connection + agent status (never returns secret values)
├─ lib/
│  ├─ splunk.mjs           Splunk Cloud client over the 443 web-REST proxy (session login)
│  ├─ gemini.mjs           Vertex AI (Gemini) via a self-signed SA JWT — zero npm deps
│  ├─ parse.mjs            SPL → dependency set (regex floor + Gemini accelerator)
│  ├─ health.mjs           the arithmetic core: now − last(dependency) > window ⇒ BLIND
│  ├─ exposure.mjs         Foundation-sec Hosted Model seam → transparent severity heuristic
│  ├─ tools.mjs            the agent's sensory spine (MCP Server when present, else REST proxy)
│  ├─ agent.mjs            orchestrates the whole run on live data
│  ├─ detections.mjs       the labelled SAMPLE estate + the sourcetypes it depends on
│  └─ env.mjs              tiny .env.local loader for the scripts
└─ scripts/
   ├─ seed.mjs             seed the SAMPLE estate + data (real _time per event) into Splunk
   └─ stop-feed.mjs        CLI to stop/resume the flip feed for a terminal-driven demo
```

### The pipeline (every verdict is arithmetic on a real timestamp)

1. **Enumerate** — `GET /services/saved/searches` over the 443 proxy returns the raw SPL,
   cron, window, and actions of every saved search. No premium app, no Enterprise Security.
2. **Parse dependencies** — a deterministic **regex** extractor always runs (the floor);
   **Gemini** (Vertex) reads the full SPL and enriches the `{index, sourcetype, source, window}`
   set (the accelerator). Gemini never decides health. Turn it off (regex-only mode) and the
   map still computes.
3. **Freshness sweep** — one pass: `| tstats latest(_time) as last by index, sourcetype`
   plus `| metadata type=sourcetypes index=*` — the real last-reporting time of every source.
4. **Compute the blind set** — pure arithmetic: `now − last(dependency) > detection.window
   ⇒ BLIND`; past the aging threshold ⇒ AGING; otherwise HEALTHY. A dependency with no
   freshness row at all *is* the silence and grades BLIND. **0 health states exist without a
   real `latest(_time)` behind them** — a health state cannot be constructed without a row.
5. **Grade exposure** — each blind detection is scored for technique class + severity, turning
   "4 down" into "your only credential-access coverage has been blind 4 days."

### Honest seams (shipped, stated, never hidden)

| Splunk AI primitive | When present | Honest fallback (what ships today) |
|---|---|---|
| **Official MCP Server** (app 7931, `/services/mcp`) | agent tools route through MCP `splunk.search` | the identical searches run over the **443 REST proxy** — same senses, different transport. The transport in force is always shown in Settings. |
| **Foundation-sec Hosted Model** (`FOUNDATION_SEC_URL`) | grades technique class + severity | a transparent, explainable **severity heuristic** computed from the detection's own cron tightness + alert action + auth/privilege/exfil category. The mode is shown on every badge. |
| **AI Assistant for SPL** | n/a | Gemini drafts dependency parses; we always **execute** the resulting freshness SPL and prove it returned rows — never ship unverified SPL. |
| Unparseable SPL (heavy macros / runtime lookups) | n/a | labelled **"dependency unknown"** — a visible gap, never a false green. |

The current trial stack has **neither** the MCP Server nor a Hosted Model installed
(self-service Splunkbase installs we can't perform headlessly), so the app runs on the
fallbacks — and they are genuinely real: the REST searches are real searches, and the
severity heuristic is computed from the detection's own metadata. Each seam activates the
moment its env var / app exists. See the `_NEEDS_*.md` notes (outside the repo) for exact
activation steps.

---

## What is REAL

Everything in the live path genuinely works on real Splunk data:

- Enumerates **real saved searches** via `GET /services/saved/searches`.
- Parses **real SPL** into dependency sets (Gemini-accelerated, regex-backed).
- Sweeps **real freshness** with `| tstats latest(_time)` + `| metadata`.
- Computes health as **arithmetic on real timestamps** — `0 health states without a real
  `latest(_time)``.
- **Writes the coverage-gap lookup back** into your own Splunk (`backstop_coverage.csv` via
  `| outputlookup`) and installs a scheduled **Backstop — Coverage Gap Monitor** saved search.
- The **live flip** happens on real timestamps: stop the feed and `now − last` crosses the
  detection's real window in seconds.
- The **Run this in Search** button deep-links the exact query into your own Splunk search bar.

**The SAMPLE demo path** seeds only the *source detections* (prefixed `Backstop Demo —`) over a
sandbox index, so the proof works even on a near-empty trial instance — but the parse, sweep,
grade, and flip are all the real mechanic, stamped **SAMPLE** the whole time. Turn SAMPLE off
in Settings to grade *your* real saved searches live.

---

## How to run

### Prerequisites
- **Node 18+** (uses global `fetch`, `crypto.createSign`). No other system deps.
- A Splunk Cloud instance reachable over its 443 web UI, and a Vertex AI service account.

### 1. Configure
```bash
cp .env.example .env.local
# edit .env.local — fill in SPLUNK_URL / SPLUNK_USER / SPLUNK_PASS and the Vertex SA path
```
All values are read **server-side only**. `.env.local` and `*-sa.json` are git-ignored.

### 2. Install
```bash
npm install
```

### 3. Seed the SAMPLE estate (optional but recommended for the demo)
```bash
npm run seed       # ingests sample sourcetypes (real _time per event) + creates the demo detections
npm run unseed     # removes the demo detections (sample data ages out on its own)
```

### 4. Run
```bash
npm run dev        # development, http://localhost:3000
# or
npm run build && npm run start
```
Open the app → **Estate** loads your detection estate → **Run** drives the agent →
**Blind Wall** is the money shot. On the Blind Wall, hit **Start the feed**, then **Stop the
feed**, and watch the C2-beacon detection flip green → BLIND on a real timestamp.

You can also drive the flip from a terminal:
```bash
npm run stop-feed              # report the frozen last-time of the flip sourcetype
node scripts/stop-feed.mjs --resume   # push a fresh event to bring it back green
```

### Environment variables

| Var | Required | What |
|---|---|---|
| `SPLUNK_URL` `SPLUNK_USER` `SPLUNK_PASS` | yes | Splunk Cloud + the 443 web-REST proxy session login |
| `SPLUNK_LOCALE` | no | default `en-GB` |
| `GOOGLE_APPLICATION_CREDENTIALS` | for Gemini | absolute path to the Vertex SA json (regex-only mode works without it) |
| `VERTEX_PROJECT` `VERTEX_LOCATION` `VERTEX_MODEL` | no | default `rapid-agents-5166` / `global` / `gemini-flash-latest` |
| `BACKSTOP_DEMO_INDEX` | no | default `backstop_demo` |
| `FOUNDATION_SEC_URL` `FOUNDATION_SEC_KEY` | no | Foundation-sec Hosted Model endpoint; unset ⇒ severity heuristic |

> The 443 proxy is public, so the same env works locally and from any deployed backend
> (Cloud Run / Vercel). On Cloud Run, bind the Vertex SA to the service instead of shipping
> the key file.

---

## Design notes

- **Tan-Han-Wei skin.** Cream `#F5F3EF`, deep ink `#1C2433`, one warm amber `#E0922B`, one
  muted teal `#3E7C7B`. **No red, no alarm UI** — a blind detection is a calm hollow light, not
  a flashing error, because the scariest thing in security is a *silence*, and you read silence
  better when nothing else is flashing.
- **The wordmark.** The two `o`'s are a traffic-light pair — a calm amber dot (watching) and a
  hollow ring (gone dark). One letter carries the whole green→BLIND story.
- **Instrument-grade numerals.** Every timestamp, count, and latency is monospace, tabular.

**37 detections. 4 are blind. Backstop is the one alert that fires when an alert can't.**
