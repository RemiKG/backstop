'use client';
import { createContext, useContext, useState, useCallback } from 'react';

const StoreCtx = createContext(null);

export function StoreProvider({ children }) {
  const [run, setRun] = useState(null); // last /api/run result
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [opts, setOpts] = useState({ useGemini: true, agingFactor: 0.5, sampleOnly: true });
  const [proof, setProof] = useState(null); // {detection, dependency} for the drawer

  const doRun = useCallback(
    async (override = {}) => {
      const o = { ...opts, ...override };
      setRunning(true);
      setError(null);
      try {
        const q = new URLSearchParams({
          gemini: o.useGemini ? '1' : '0',
          all: o.sampleOnly ? '0' : '1',
          aging: String(o.agingFactor),
        });
        const r = await fetch('/api/run?' + q.toString());
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        setRun(j);
        return j;
      } catch (e) {
        setError(String(e.message || e));
        throw e;
      } finally {
        setRunning(false);
      }
    },
    [opts]
  );

  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch('/api/config');
      const j = await r.json();
      setConfig(j);
      return j;
    } catch {
      return null;
    }
  }, []);

  return (
    <StoreCtx.Provider
      value={{ run, setRun, running, error, doRun, config, loadConfig, opts, setOpts, proof, setProof }}
    >
      {children}
    </StoreCtx.Provider>
  );
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore outside provider');
  return c;
}
