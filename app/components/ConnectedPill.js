'use client';
import { useEffect } from 'react';
import { useStore } from './store';

export default function ConnectedPill() {
  const { config, loadConfig, opts } = useStore();
  useEffect(() => {
    if (!config) loadConfig();
  }, [config, loadConfig]);

  const sp = config?.splunk;
  const connected = sp?.connected;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      {opts.sampleOnly && <span className="pill sample">● SAMPLE</span>}
      <span className={`pill ${connected ? 'ok' : ''}`} title={sp?.host || ''}>
        <span className="pdot" />
        {connected ? (
          <>
            Splunk Cloud {sp.version ? sp.version : '10.4'} · {sp.transport === 'mcp-server' ? 'MCP' : 'REST'}
          </>
        ) : config ? (
          'Disconnected'
        ) : (
          'Connecting…'
        )}
      </span>
    </div>
  );
}
