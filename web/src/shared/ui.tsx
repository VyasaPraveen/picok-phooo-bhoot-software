import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { hashPin } from './crypto';

// ---- toast ----

type ToastFn = (message: string, error?: boolean) => void;
const ToastContext = createContext<ToastFn>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; error: boolean; id: number } | null>(null);
  const show = useCallback<ToastFn>((message, error = false) => setToast({ message, error, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status" aria-live="polite" key={toast.id}>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// ---- small controls ----

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Segmented<T extends string | boolean>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- PIN pad ----

export type PinRole = 'admin' | 'operator';

// Wrong-PIN lockout survives an app reload.
const LOCK_KEY = 'picok.pinLock';
const readLock = (): { failed: number; lockedUntil: number } => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCK_KEY) ?? '{}') as { failed?: number; lockedUntil?: number };
    return { failed: Number(v.failed) || 0, lockedUntil: Number(v.lockedUntil) || 0 };
  } catch {
    return { failed: 0, lockedUntil: 0 };
  }
};
const writeLock = (failed: number, lockedUntil: number) => {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ failed, lockedUntil }));
  } catch {
    // Storage blocked: the lockout lasts until the app reloads.
  }
};
let { failed, lockedUntil } = readLock();

/**
 * Numeric PIN pad. Resolves the unlocked role; five wrong PINs lock entry for 60 s.
 * Hashes come from /booths/{b}/pins; defaults apply until the admin changes them.
 */
export function PinPad({
  title,
  adminHash,
  operatorHash,
  adminOnly = false,
  onDone,
}: {
  title: string;
  adminHash: string;
  operatorHash: string;
  adminOnly?: boolean;
  onDone: (role: PinRole | null) => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);

  const submit = async () => {
    if (busy.current) return;
    const wait = Math.ceil((lockedUntil - Date.now()) / 1000);
    if (wait > 0) {
      setError(`Too many attempts. Try again in ${wait} s.`);
      return;
    }
    busy.current = true;
    const h = await hashPin(pin);
    busy.current = false;
    const role: PinRole | null = h === adminHash ? 'admin' : h === operatorHash ? 'operator' : null;
    if (!role || (adminOnly && role !== 'admin')) {
      setPin('');
      if (!role && ++failed >= 5) {
        failed = 0;
        lockedUntil = Date.now() + 60_000;
      }
      writeLock(failed, lockedUntil);
      setError(role ? 'Admin PIN required' : 'Wrong PIN');
      return;
    }
    failed = 0;
    writeLock(0, lockedUntil);
    onDone(role);
  };

  const press = (d: string) => {
    setError('');
    setPin((p) => (p.length >= 8 ? p : p + d));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={() => onDone(null)}>
      <div className="pinpad card" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="pin-dots" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span key={i} className={i < pin.length ? 'on' : ''} />
          ))}
        </div>
        <div className="pin-error" aria-live="assertive">{error}</div>
        <div className="pin-grid">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" onClick={() => press(d)}>{d}</button>
          ))}
          <button type="button" aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
          <button type="button" onClick={() => press('0')}>0</button>
          <button type="button" aria-label="OK" disabled={pin.length < 4} onClick={() => void submit()}>✓</button>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  );
}

// ---- crash screen ----

/**
 * Catches a rendering crash instead of leaving a blank screen. The booth (`autoReload`) restarts
 * itself after a few seconds; the dashboard offers a reload button.
 */
export class ErrorBoundary extends Component<{ autoReload?: boolean; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    if (this.props.autoReload) setTimeout(() => location.reload(), 5000);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center-screen" role="alert" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
        <h1>Something went wrong</h1>
        <p className="dim">{this.props.autoReload ? 'The booth restarts in a few seconds.' : 'Reload the page to continue.'}</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>Reload now</button>
      </div>
    );
  }
}
