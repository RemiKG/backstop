'use client';
import { useEffect } from 'react';
import { useStore } from '../components/store';
import ConnectedPill from '../components/ConnectedPill';

function Toggle({ value, onChange, on = 'On', off = 'Off' }) {
  return (
    <div className="toggle">
      <button className={value ? 'on' : ''} onClick={() => onChange(true)}>
        {on}
      </button>
      <button className={!value ? 'on' : ''} onClick={() => onChange(false)}>
        {off}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { config, loadConfig, opts, setOpts, doRun } = useStore();
  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sp = config?.splunk || {};
  const gem = config?.gemini || {};
  const fnd = config?.foundationSec || {};
  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">
            The instrument, tuned. Connection, the arithmetic you own, the agent + models, and
            hand-back scheduling. The transport and exposure mode in force are always shown — never
            hidden.
          </div>
        </div>
        <div className="head-tools">
          <ConnectedPill />
        </div>
      </div>

      <div className="panels">
        {/* A — connection */}
        <div className="panel">
          <h3>Splunk connection</h3>
          <div className="p-sub">Splunk Cloud over the 443 web-REST proxy. Session login.</div>
          <div className="field">
            <span className="f-lab">Host</span>
            <span className="f-val">{sp.host || '—'}</span>
          </div>
          <div className="field">
            <span className="f-lab">Session</span>
            <span className="f-val" style={{ color: sp.connected ? 'var(--teal)' : 'var(--accent)' }}>
              {sp.connected ? 'logged in' : config ? 'disconnected' : '…'}
            </span>
          </div>
          <div className="field">
            <span className="f-lab">Version</span>
            <span className="f-val">{sp.version || 'Splunk Cloud 10.4'}</span>
          </div>
          <div className="field">
            <span className="f-lab">Round-trip</span>
            <span className="f-val">{sp.roundTripMs != null ? sp.roundTripMs + ' ms' : '—'}</span>
          </div>
          <div className="field">
            <span className="f-lab">Transport mode</span>
            <span className={`badge-mode ${sp.transport === 'mcp-server' ? 'real' : 'fallback'}`}>
              {sp.transport === 'mcp-server' ? 'MCP Server' : 'REST proxy'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
            {sp.mcpAvailable
              ? 'Official Splunk MCP Server detected — agent tools route through it.'
              : 'MCP Server not installed in this trial — identical searches run over the 443 REST proxy. Same senses, different transport.'}
          </div>
          <button className="btn sm" style={{ marginTop: 12 }} onClick={() => loadConfig()}>
            Re-probe connection
          </button>
        </div>

        {/* B — what counts as blind */}
        <div className="panel">
          <h3>What counts as blind</h3>
          <div className="p-sub">The arithmetic you own. now − last(dependency) &gt; window ⇒ BLIND.</div>
          <div className="field">
            <span className="f-lab">Aging threshold</span>
            <span className="f-val">
              <input
                type="range"
                min="0.2"
                max="0.9"
                step="0.05"
                value={opts.agingFactor}
                onChange={(e) => setOpt('agingFactor', parseFloat(e.target.value))}
                style={{ verticalAlign: 'middle' }}
              />{' '}
              {Math.round(opts.agingFactor * 100)}% of window
            </span>
          </div>
          <div className="field">
            <span className="f-lab">Default window fallback</span>
            <span className="f-val">-24h</span>
          </div>
          <div className="field">
            <span className="f-lab">Dependency-unknown policy</span>
            <span className="f-val">visible gap (never green)</span>
          </div>
          <div className="field">
            <span className="f-lab">Quiet-by-design allowlist</span>
            <span className="f-val" style={{ color: 'var(--ink-faint)' }}>none set</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
            Health is arithmetic on real timestamps, never a model verdict. A sourcetype meant to be
            quiet can be allowlisted so idle ≠ blind; we flag <i>aging</i> before <i>blind</i> and you
            confirm intent.
          </div>
        </div>

        {/* C — agent + models */}
        <div className="panel">
          <h3>Agent + models</h3>
          <div className="p-sub">Gemini accelerates the parse; Foundation-sec grades exposure.</div>
          <div className="field">
            <span className="f-lab">Gemini (Vertex) project</span>
            <span className="f-val">{gem.project || '—'}</span>
          </div>
          <div className="field">
            <span className="f-lab">Model</span>
            <span className="f-val">{gem.model || '—'}</span>
          </div>
          <div className="field">
            <span className="f-lab">Regex-only mode</span>
            <Toggle value={!opts.useGemini} onChange={(v) => setOpt('useGemini', !v)} on="On" off="Off" />
          </div>
          <div className="field">
            <span className="f-lab">Foundation-sec Hosted Model</span>
            <span className={`badge-mode ${fnd.configured ? 'real' : 'fallback'}`}>
              {fnd.configured ? 'enabled' : 'heuristic fallback'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
            {opts.useGemini
              ? 'Gemini parses your SPL into dependencies — strip it out (regex-only) and a regex-extracted index=/sourcetype= still drives a correct map.'
              : 'Regex-only: dependencies come straight from regex-extracted index=/sourcetype=. Gemini is off — the map still computes.'}
          </div>
        </div>

        {/* D — hand-back + scheduling */}
        <div className="panel">
          <h3>Hand-back + scheduling</h3>
          <div className="p-sub">Where the gap-map lands and how the meta-detection runs.</div>
          <div className="field">
            <span className="f-lab">Lookup name</span>
            <span className="f-val">backstop_coverage.csv</span>
          </div>
          <div className="field">
            <span className="f-lab">Write mode</span>
            <span className="f-val">overwrite</span>
          </div>
          <div className="field">
            <span className="f-lab">Backstop schedule</span>
            <span className="f-val">*/15 * * * *</span>
          </div>
          <div className="field">
            <span className="f-lab">Alert action</span>
            <span className="f-val">email</span>
          </div>
          <div className="field">
            <span className="f-lab">SAMPLE demo path</span>
            <Toggle value={opts.sampleOnly} onChange={(v) => setOpt('sampleOnly', v)} on="On" off="Off" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
            SAMPLE grades only the seeded <span className="mono">Backstop Demo —</span> detections over
            the sandbox index. Turn it off to grade <i>your</i> real saved searches live.
          </div>
        </div>
      </div>

      <button
        className="btn primary"
        style={{ marginTop: 24 }}
        onClick={() => doRun().catch(() => {})}
      >
        Re-run Backstop with these settings →
      </button>
    </>
  );
}
