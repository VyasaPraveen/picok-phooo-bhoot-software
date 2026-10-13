import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '../shared/theme.css';
import './kiosk.css';
import { ErrorBoundary } from '../shared/ui';
import { KioskApp } from './KioskApp';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary autoReload>
      <KioskApp />
    </ErrorBoundary>
  </StrictMode>,
);
