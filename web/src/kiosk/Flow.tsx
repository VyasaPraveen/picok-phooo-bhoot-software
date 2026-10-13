import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrintSizeKey } from '../render';
import type { BoothData } from '../shared/booth';
import { DEFAULT_ADMIN_PIN, DEFAULT_OPERATOR_PIN, hashPin } from '../shared/crypto';
import { priceFor, type Order } from '../shared/model';
import type { SourcedTemplate } from '../shared/templates';
import { PinPad, type PinRole } from '../shared/ui';
import { OperatorPanel } from './OperatorPanel';
import { CaptureScreen } from './screens/Capture';
import { PaymentScreen } from './screens/Payment';
import { PreviewScreen, PrintingScreen } from './screens/Output';
import { AttractScreen, OptionsScreen, SizeScreen, TemplateScreen } from './screens/Choose';
import { purgePrints } from './printStore';

export type Step = 'attract' | 'size' | 'template' | 'options' | 'payment' | 'capture' | 'preview' | 'printing';

/** Choices of the current customer, from "Tap to start" to the print. */
export interface Session {
  size: PrintSizeKey | null;
  template: SourcedTemplate | null;
  bw: boolean;
  copies: number;
  order: Order | null;
  photos: CanvasImageSource[];
  printBlob: Blob | null;
}

export const newSession = (): Session => ({ size: null, template: null, bw: false, copies: 1, order: null, photos: [], printBlob: null });

export const sessionTotal = (s: Session, data: BoothData) =>
  s.size ? priceFor(data.settings, s.size, s.bw, s.copies) : 0;

export interface StepProps {
  boothId: string;
  data: BoothData;
  session: Session;
  go: (step: Step) => void;
  reset: () => void;
  touch: () => void;
}

const IDLE_STEPS: Step[] = ['size', 'template', 'options'];

export function Flow({ boothId, data }: { boothId: string; data: BoothData }) {
  const [step, setStep] = useState<Step>('attract');
  const [session, setSession] = useState<Session>(newSession);
  const [askPin, setAskPin] = useState(false);
  const [panel, setPanel] = useState<PinRole | null>(null);
  const [hashes, setHashes] = useState({ admin: '', operator: '' });
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    void Promise.all([hashPin(DEFAULT_ADMIN_PIN), hashPin(DEFAULT_OPERATOR_PIN)]).then(([a, o]) =>
      setHashes({ admin: data.pins.adminHash || a, operator: data.pins.operatorHash || o }),
    );
  }, [data.pins]);

  const reset = useCallback(() => {
    setSession(newSession());
    setStep('attract');
    void purgePrints(data.settings.retentionMinutes).catch(() => undefined);
  }, [data.settings.retentionMinutes]);

  const touch = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    if (IDLE_STEPS.includes(stepRef.current)) {
      idle.current = setTimeout(reset, data.settings.inactivitySeconds * 1000);
    }
  }, [reset, data.settings.inactivitySeconds]);

  const go = useCallback((s: Step) => {
    stepRef.current = s;
    setStep(s);
  }, []);

  useEffect(() => {
    touch();
    return () => {
      if (idle.current) clearTimeout(idle.current);
    };
  }, [step, touch]);

  useKioskScreen();

  const resume = (order: Order, template: SourcedTemplate | undefined, blob: Blob | null) => {
    setPanel(null);
    if (!template) return;
    setSession({ ...newSession(), size: order.size, template, bw: order.bw, copies: order.copies, order, printBlob: blob });
    go(blob ? 'printing' : 'capture');
  };

  const props: StepProps = { boothId, data, session, go, reset, touch };
  let screen;
  switch (step) {
    case 'attract':
      screen = <AttractScreen {...props} onStaff={() => setAskPin(true)} />;
      break;
    case 'size':
      screen = <SizeScreen {...props} />;
      break;
    case 'template':
      screen = <TemplateScreen {...props} />;
      break;
    case 'options':
      screen = <OptionsScreen {...props} />;
      break;
    case 'payment':
      screen = <PaymentScreen {...props} />;
      break;
    case 'capture':
      screen = <CaptureScreen {...props} />;
      break;
    case 'preview':
      screen = <PreviewScreen {...props} />;
      break;
    case 'printing':
      screen = <PrintingScreen {...props} />;
      break;
  }

  return (
    <div className="kiosk" onPointerDown={touch}>
      <div className="glow" aria-hidden />
      <main className="kiosk-main" key={step}>
        {screen}
      </main>
      {askPin && hashes.admin && (
        <PinPad
          title="Operator / Admin PIN"
          adminHash={hashes.admin}
          operatorHash={hashes.operator}
          onDone={(role) => {
            setAskPin(false);
            if (role) setPanel(role);
          }}
        />
      )}
      {panel && <OperatorPanel boothId={boothId} data={data} role={panel} onClose={() => setPanel(null)} onResume={resume} />}
    </div>
  );
}

/** Keeps the tablet awake and full-screen while the booth runs. */
function useKioskScreen() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
      } catch {
        // Not supported or denied: the tablet's screen timeout applies.
      }
    };
    const onVisible = () => void acquire();
    const goFull = () => {
      const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
      if (!standalone && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('pointerdown', goFull);
    const noMenu = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', noMenu);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('pointerdown', goFull);
      document.removeEventListener('contextmenu', noMenu);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}
