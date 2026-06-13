'use client';
import { stateLabel } from './format';

export default function StatusLight({ state, pulse = false }) {
  return (
    <span className={`light ${state}${pulse && state === 'healthy' ? ' pulse' : ''}`}>
      <span className="lamp" />
      {stateLabel(state)}
    </span>
  );
}
