import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '../shared/theme.css';
import './kiosk.css';
import { ErrorBoundary } from '../shared/ui';
import { KioskApp, restoreTheme } from './KioskApp';
import { markUpdateReady } from './updates';

registerSW({ immediate: true, onNeedReload: markUpdateReady });
restoreTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary autoReload>
      <KioskApp />
    </ErrorBoundary>
  </StrictMode>,
);
