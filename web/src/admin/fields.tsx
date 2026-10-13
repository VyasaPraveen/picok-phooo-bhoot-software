import { ref, update } from 'firebase/database';
import { useEffect, useState, type ReactNode } from 'react';
import type { BoothData } from '../shared/booth';
import { db } from '../shared/firebase';
import type { BoothSettings } from '../shared/model';

export interface SectionProps {
  boothId: string;
  data: BoothData;
}

export const saveSettings = (boothId: string, patch: Partial<BoothSettings>) =>
  update(ref(db, `booths/${boothId}/settings`), patch);

export function Panel({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel card">
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="dim">{subtitle}</p>}
        </div>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {help && <small className="dim">{help}</small>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

/** Text input that saves when you leave the field or press Enter. */
export function CommitInput({
  value,
  onCommit,
  placeholder,
  type = 'text',
  validate,
  width,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  type?: string;
  validate?: (v: string) => string | null;
  width?: number | string;
}) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const t = v.trim();
    const err = validate?.(t) ?? null;
    setError(err);
    if (!err && t !== value) onCommit(t);
  };
  return (
    <span className="commit-input" style={{ width }}>
      <input
        type={type}
        value={v}
        placeholder={placeholder}
        aria-invalid={!!error}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {error && <small className="error-text">{error}</small>}
    </span>
  );
}

/** Rupee amount field that stores paise. */
export function RupeeInput({ paise, onChange }: { paise: number; onChange: (p: number) => void }) {
  return (
    <CommitInput
      width={110}
      type="number"
      value={paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2)}
      validate={(t) => {
        const n = Number(t);
        return t === '' || !Number.isFinite(n) || n < 0 || n > 100000 ? 'Invalid' : null;
      }}
      onCommit={(t) => onChange(Math.round(Number(t) * 100))}
    />
  );
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <span className="mini-stepper">
      <button type="button" aria-label="Decrease" disabled={value - step < min} onClick={() => onChange(value - step)}>−</button>
      <span>{value}{suffix}</span>
      <button type="button" aria-label="Increase" disabled={value + step > max} onClick={() => onChange(value + step)}>+</button>
    </span>
  );
}

/** Reads an image file, scales it down to fit `maxSide`, and returns PNG base64 plus size. */
export async function imageFileToPng(file: File, maxSide: number): Promise<{ data: string; width: number; height: number }> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error('Please choose a PNG, JPG or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is too large (max 15 MB).');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const url = c.toDataURL('image/png');
  const data = url.slice(url.indexOf(',') + 1);
  // Stored in the Realtime Database, which refuses single values over 10 MB.
  if (data.length > 8_000_000) throw new Error('That image is too detailed to store. Export it with fewer colours or a smaller size.');
  return { data, width: w, height: h };
}

export const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
