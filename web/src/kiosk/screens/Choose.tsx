import { useEffect, useMemo, useRef, useState } from 'react';
import { FILTER_NAMES, MEDIA_ROLLS, PRINT_SIZES, type PrintSizeKey } from '../../render';
import type { BoothData } from '../../shared/booth';
import { bridgeOnline, fromPrice, rupees } from '../../shared/model';
import { visibleFor, type SourcedTemplate } from '../../shared/templates';
import { TemplateThumb } from '../../shared/Thumb';
import { sessionTotal, type StepProps } from '../Flow';

export function availableSizes(data: BoothData): PrintSizeKey[] {
  const s = data.settings;
  return MEDIA_ROLLS[s.loadedRoll].sizes.filter((k) => !s.disabledSizes.includes(k));
}

/** Why the booth cannot take customers right now, or null when ready. */
export function boothProblem(data: BoothData): string | null {
  const s = data.settings;
  if (availableSizes(data).length === 0) return 'No print sizes are switched on. Please call the operator.';
  if (s.printMode === 'bridge') {
    if (!bridgeOnline(data.bridge)) return 'The printer is starting up. Please call the operator.';
    if ((data.state?.printsRemaining ?? 0) <= 0) return 'We are changing the paper. Back in a moment!';
  }
  return null;
}

export function StepHeader({ step, title, subtitle, right }: { step: number; title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <header className="step-header">
      <img src="/brand/picok_logo_transparent.png" alt="Picok" className="header-logo" />
      <div className="step-titles">
        <h1>{title}</h1>
        {subtitle && <p className="dim">{subtitle}</p>}
      </div>
      <div className="step-dots" aria-label={`Step ${step} of 8`}>
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={i + 1 === step ? 'current' : i + 1 < step ? 'done' : ''} />
        ))}
      </div>
      {right}
    </header>
  );
}

// ---- Step 1 · Tap to start ----

export function AttractScreen({ data, go, onStaff }: StepProps & { onStaff: () => void }) {
  const s = data.settings;
  const problem = boothProblem(data);
  const sizes = availableSizes(data);
  const samples = useMemo(() => {
    const out: SourcedTemplate[] = [];
    for (const k of sizes) out.push(...visibleFor(data.templates, s, k).filter((t) => t.category !== 'standard'));
    if (!out.length) for (const k of sizes) out.push(...visibleFor(data.templates, s, k).slice(0, 2));
    return out;
  }, [data.templates, s, sizes]);
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => n + 1), 3200);
    return () => clearInterval(t);
  }, []);
  const taps = useRef<number[]>([]);
  const secret = (e: React.PointerEvent) => {
    e.stopPropagation();
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      onStaff();
    }
  };
  const minPrice = sizes.length ? Math.min(...sizes.map((k) => fromPrice(s, k))) : 0;
  const sample = samples.length ? samples[i % samples.length] : null;
  const demo = s.paymentMode === 'demo' || s.printMode === 'demo';

  return (
    <div className="attract" onClick={() => !problem && go('size')}>
      <div className="staff-hotspot" onPointerDown={secret} onClick={(e) => e.stopPropagation()} aria-hidden />
      <section className="attract-left">
        <img src="/brand/picok_logo_transparent.png" alt="Picok" className="attract-logo" />
        {s.eventName && <h2 className="event-name rainbow-text">{s.eventName}</h2>}
        {s.eventDate && <p className="dim event-date">{s.eventDate}</p>}
        <p className="tagline">Strike a pose. Take home a print in seconds.</p>
        {problem ? (
          <div className="problem-box" role="alert">ⓘ {problem}</div>
        ) : (
          <button className="btn btn-primary btn-xl pulse" onClick={() => go('size')}>
            Tap to start 📸
          </button>
        )}
        {!problem && (
          <p className="price-hint">{s.freeMode ? 'Prints are FREE today — enjoy!' : `Prints from ${rupees(minPrice)} · Pay by any UPI app`}</p>
        )}
        <div className="grow" />
        {s.showConsent && <p className="consent dim">{s.consentText}</p>}
        {demo && <span className="demo-badge">DEMO MODE</span>}
      </section>
      <section className="attract-right" aria-hidden>
        {sample && (
          <div key={i} className="sample-print" style={{ transform: `rotate(${i % 2 ? 2 : -2}deg)` }}>
            <TemplateThumb template={sample} scale={0.35} />
          </div>
        )}
      </section>
    </div>
  );
}

// ---- Step 2 · Choose print size ----

export function SizeScreen({ data, session, go, reset }: StepProps) {
  const s = data.settings;
  return (
    <div className="screen">
      <StepHeader step={2} title="Choose your print size" subtitle="Tap a size to continue" />
      <div className="size-row">
        {availableSizes(data).map((k) => {
          const info = PRINT_SIZES[k];
          const sample = visibleFor(data.templates, s, k)[0];
          return (
            <button
              key={k}
              className="size-card card"
              onClick={() => {
                if (session.size !== k) session.template = null;
                session.size = k;
                go('template');
              }}
            >
              <div className="size-sample">{sample && <TemplateThumb template={sample} scale={0.22} className="shadowed" />}</div>
              <strong className="size-label">{info.label}</strong>
              <span className="dim">{info.mm}</span>
              <span>{info.blurb}</span>
              <span className="price-pill">{s.freeMode ? 'FREE' : rupees(fromPrice(s, k))}</span>
            </button>
          );
        })}
      </div>
      <footer className="step-footer">
        <button className="btn btn-ghost" onClick={reset}>⌂ Start over</button>
      </footer>
    </div>
  );
}

// ---- Step 3 · Choose layout & template ----

export function TemplateScreen({ data, session, go }: StepProps) {
  const size = session.size!;
  const all = visibleFor(data.templates, data.settings, size);
  const counts = [...new Set(all.map((t) => t.slots.length))].sort();
  const [filter, setFilter] = useState<number | null>(null);
  const [selected, setSelected] = useState<SourcedTemplate | null>(
    session.template && all.some((t) => t.id === session.template!.id) ? session.template : all[0] ?? null,
  );
  const shown = filter === null ? all : all.filter((t) => t.slots.length === filter);
  const badge = (c: string) =>
    c === 'retro' ? ['AI RETRO', 'pink'] : c === 'festival' || c === 'event' ? ['SPECIAL', 'orange'] : c === 'custom' ? ['CUSTOM', 'green'] : null;

  return (
    <div className="screen">
      <StepHeader step={3} title="Pick your layout & design" subtitle={PRINT_SIZES[size].label} />
      <div className="template-layout">
        <div className="template-list">
          <div className="chips">
            <button className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>All designs</button>
            {counts.map((c) => (
              <button key={c} className="chip" aria-pressed={filter === c} onClick={() => setFilter(c)}>
                {c} photo{c === 1 ? '' : 's'}
              </button>
            ))}
          </div>
          <div className="template-grid">
            {shown.map((t) => {
              const b = badge(t.category);
              return (
                <button
                  key={t.id}
                  className={`template-tile ${selected?.id === t.id ? 'selected' : ''}`}
                  aria-pressed={selected?.id === t.id}
                  onClick={() => setSelected(t)}
                >
                  <TemplateThumb template={t} scale={0.16} />
                  <span className="tile-name">{t.name}</span>
                  <span className="tile-meta">
                    {t.slots.length} 📷 {b && <em className={`badge ${b[1]}`}>{b[0]}</em>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <aside className="template-preview">
          {selected ? (
            <>
              <div className="preview-wrap">
                <TemplateThumb key={selected.id} template={selected} scale={0.4} className="shadowed" />
              </div>
              <h2>{selected.name}</h2>
              <p className="dim">
                {selected.slots.length} photo{selected.slots.length === 1 ? '' : 's'}
                {selected.filter && selected.filter !== 'none' ? ` · ${FILTER_NAMES[selected.filter] ?? selected.filter} filter` : ''}
              </p>
            </>
          ) : (
            <p>No designs available for this size.</p>
          )}
        </aside>
      </div>
      <footer className="step-footer">
        <button className="btn btn-ghost" onClick={() => go('size')}>← Back</button>
        <button
          className="btn btn-primary"
          disabled={!selected}
          onClick={() => {
            session.template = selected;
            session.bw = selected?.filter === 'classic_bw';
            go('options');
          }}
        >
          Use this design →
        </button>
      </footer>
    </div>
  );
}

// ---- Step 4 · Colour or B&W, copies ----

export function OptionsScreen({ data, session, go, touch }: StepProps) {
  const s = data.settings;
  const size = session.size!;
  const t = session.template!;
  const price = s.prices[size];
  const [, force] = useState(0);
  const set = (f: () => void) => {
    f();
    force((n) => n + 1);
    touch();
  };
  if (session.copies > s.maxCopies) session.copies = s.maxCopies;
  const total = sessionTotal(session, data);

  return (
    <div className="screen">
      <StepHeader step={4} title="Colour or black & white?" subtitle={`${PRINT_SIZES[size].label} · ${t.name}`} />
      <div className="options-layout">
        {[false, true].map((bw) => (
          <button
            key={String(bw)}
            className={`mode-card card ${session.bw === bw ? 'selected' : ''}`}
            aria-pressed={session.bw === bw}
            onClick={() => set(() => (session.bw = bw))}
          >
            <div className="mode-thumb"><TemplateThumb template={t} bw={bw} scale={0.25} /></div>
            <strong>{session.bw === bw ? '◉' : '○'} {bw ? 'Black & white' : 'Colour'}</strong>
            {!s.freeMode && <span className="dim">{rupees(bw ? price.bw : price.colour)}</span>}
          </button>
        ))}
        <div className="copies card">
          <h2>How many copies?</h2>
          {PRINT_SIZES[size].isStrip && <p className="dim">Each copy gives you 2 strips</p>}
          <div className="stepper">
            <button aria-label="One less copy" disabled={session.copies <= 1} onClick={() => set(() => session.copies--)}>−</button>
            <span aria-live="polite">{session.copies}</span>
            <button aria-label="One more copy" disabled={session.copies >= s.maxCopies} onClick={() => set(() => session.copies++)}>+</button>
          </div>
          {!s.freeMode && (
            <dl className="breakdown">
              <dt>First copy</dt>
              <dd>{rupees(session.bw ? price.bw : price.colour)}</dd>
              {session.copies > 1 && (
                <>
                  <dt>{session.copies - 1} extra × {rupees(price.extraCopy)}</dt>
                  <dd>{rupees((session.copies - 1) * price.extraCopy)}</dd>
                </>
              )}
            </dl>
          )}
          <div className="total">
            <span>Total</span>
            <strong>{s.freeMode ? 'FREE' : rupees(total)}</strong>
          </div>
        </div>
      </div>
      <footer className="step-footer">
        <button className="btn btn-ghost" onClick={() => go('template')}>← Back</button>
        <button className="btn btn-primary" onClick={() => go('payment')}>
          {s.freeMode ? 'Continue →' : `Pay ${rupees(total)} ▦`}
        </button>
      </footer>
    </div>
  );
}

