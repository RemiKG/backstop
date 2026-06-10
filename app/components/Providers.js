'use client';
import { StoreProvider } from './store';
import ProofDrawer from './ProofDrawer';

export default function Providers({ children }) {
  return (
    <StoreProvider>
      {children}
      <ProofDrawer />
    </StoreProvider>
  );
}
