import { onValue, push, ref, update } from 'firebase/database';
import { useEffect, useState, type FormEvent } from 'react';
import { MEDIA_ROLLS, PRINT_SIZES, type MediaRollKey } from '../../render';
import { DEFAULT_ADMIN_PIN, DEFAULT_OPERATOR_PIN, hashPin } from '../../shared/crypto';
import { db, serverNow } from '../../shared/firebase';
import { bridgeOnline } from '../../shared/model';
import { clearThumbCache } from '../../shared/Thumb';
import { Segmented, Toggle, useToast } from '../../shared/ui';
import { Panel, Row, saveSettings, Stepper, type SectionProps } from '../fields';

const setState = (boothId: string, patch: Record<string, unknown>) =>
  update(ref(db, `booths/${boothId}/state`), { ...patch, updatedAt: Date.now() });

export function PaperSection({ boothId, data }: SectionProps) {
  const toast = useToast();
  const s = data.settings;
  const roll = MEDIA_ROLLS[s.loadedRoll];
  const paper = data.state?.printsRemaining ?? 0;
  const online = bridgeOnline(data.bridge);
  const [test, setTest] = useState<{ id: string; status: string; message?: string } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!test?.id) return;
    return onValue(ref(db, `booths/${boothId}/testPrints/${test.id}`), (snap) => {
      const v = snap.val() as { status?: string; message?: string } | null;
      if (v) setTest({ id: test.id, status: v.status ?? 'queued', message: v.message });
    });
  }, [boothId, test?.id]);

  const sendTest = async () => {
    if (sending) return;
    setSending(true);
    try {
      const media = roll.sizes.find((k) => !s.disabledSizes.includes(k)) ?? roll.sizes[0];
      const r = push(ref(db, `booths/${boothId}/testPrints`));
      await update(r, { media, finish: s.finish, status: 'queued', message: '', createdAt: serverNow(), updatedAt: serverNow() });
      setTest({ id: r.key!, status: 'queued' });
      toast(`Test print (${media}) sent to the print PC.`);
    } catch {
      toast('Could not send the test print. Check your connection.', true);
    } finally {
      setSending(false);
    }
  };

  const changeRoll = async (key: MediaRollKey) => {
    if (key === s.loadedRoll) return;
    await saveSettings(boothId, { loadedRoll: key });
    await setState(boothId, { printsRemaining: MEDIA_ROLLS[key].capacity, loadedRoll: key });
    clearThumbCache();
    toast(`Media set to ${MEDIA_ROLLS[key].label}. Counter reset to ${MEDIA_ROLLS[key].capacity}.`);
  };

  return (
    <>
      <Panel title="Printer" subtitle={s.printMode === 'demo' ? 'Demo printing is on (Booth settings) – nothing is sent to the printer.' : undefined}>
        <ul className="status-list">
          <li><span>Print PC</span><strong className={online ? 'ok' : 'bad'}>{online ? `Online · ${data.bridge?.name ?? ''} (v${data.bridge?.version ?? '?'})` : 'Offline'}</strong></li>
          <li><span>Printer</span><strong>{online ? `${data.bridge?.printer?.name ?? ''} · ${data.bridge?.printer?.message || data.bridge?.printer?.state}` : '—'}</strong></li>
        </ul>
        <div className="row-gap start">
          <button className="btn btn-soft btn-sm" disabled={!online || sending || test?.status === 'queued' || test?.status === 'printing'} onClick={() => void sendTest()}>⎙ Send test print</button>
          {test && <span className="dim">Test print: {test.status}{test.message ? ` · ${test.message}` : ''}</span>}
        </div>
      </Panel>
      <Panel
        title="Paper counter"
        subtitle="Counts prints left on the loaded roll and warns before it runs out"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => confirm(`Reset the counter to ${roll.capacity} prints?`) && void setState(boothId, { printsRemaining: roll.capacity })}>
            ↻ New roll loaded
          </button>
        }
      >
        <div className="paper-big">
          <strong className={paper <= s.lowPaperThreshold ? 'bad' : ''}>{paper}</strong>
          <span className="dim">prints left of {roll.capacity}</span>
        </div>
        {paper <= s.lowPaperThreshold && <p className="warn">Paper is running low — keep a new media set ready.</p>}
        <Row label="Adjust count">
          <Stepper value={paper} min={0} max={2000} onChange={(v) => void setState(boothId, { printsRemaining: v })} />
        </Row>
        <Row label="Warn when below">
          <Stepper value={s.lowPaperThreshold} min={0} max={300} step={10} onChange={(v) => void saveSettings(boothId, { lowPaperThreshold: v })} />
        </Row>
      </Panel>
      <Panel title="Loaded media" subtitle="The DNP holds one roll at a time. Customers only see the sizes this roll can print.">
        <Row label="Roll in the printer">
          <select value={s.loadedRoll} onChange={(e) => void changeRoll(e.target.value as MediaRollKey)}>
            {Object.values(MEDIA_ROLLS).map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </Row>
        {roll.sizes.map((k) => (
          <Row key={k} label={`Offer ${PRINT_SIZES[k].label}`}>
            <Toggle
              label={`Offer ${PRINT_SIZES[k].label}`}
              checked={!s.disabledSizes.includes(k)}
              onChange={(on) =>
                void saveSettings(boothId, { disabledSizes: on ? s.disabledSizes.filter((x) => x !== k) : [...s.disabledSizes, k] })
              }
            />
          </Row>
        ))}
        <Row label="Print finish" help="The Print Bridge applies the matching DNP driver profile">
          <Segmented
            label="Print finish"
            value={s.finish}
            options={[{ value: 'gloss', label: 'Gloss' }, { value: 'matte', label: 'Matte' }]}
            onChange={(v) => void saveSettings(boothId, { finish: v })}
          />
        </Row>
      </Panel>
    </>
  );
}

export function BoothSettingsSection({ boothId, data }: SectionProps) {
  const s = data.settings;
  const save = (patch: Parameters<typeof saveSettings>[1]) => void saveSettings(boothId, patch);
  const [pinFor, setPinFor] = useState<'admin' | 'operator' | null>(null);
  return (
    <>
      <Panel title="Live or demo" subtitle="Demo mode lets you show the full booth without the print PC or real payments.">
        <Row label="Payments" help="Demo: QR is simulated, no money is taken. Live: Razorpay UPI through the Print Bridge PC.">
          <Segmented label="Payment mode" value={s.paymentMode} options={[{ value: 'demo', label: 'Demo' }, { value: 'bridge', label: 'Live (Razorpay)' }]} onChange={(v) => save({ paymentMode: v })} />
        </Row>
        <Row label="Printing" help="Demo: the print is shown and can be downloaded. Live: sent encrypted to the DNP printer.">
          <Segmented label="Print mode" value={s.printMode} options={[{ value: 'demo', label: 'Demo' }, { value: 'bridge', label: 'Live (DNP printer)' }]} onChange={(v) => save({ printMode: v })} />
        </Row>
      </Panel>
      <Panel title="Camera">
        <Row label="Countdown"><Stepper value={s.countdownSeconds} min={1} max={10} suffix=" s" onChange={(v) => save({ countdownSeconds: v })} /></Row>
        <Row label="Retakes allowed per photo"><Stepper value={s.retakesAllowed} min={0} max={5} onChange={(v) => save({ retakesAllowed: v })} /></Row>
        <Row label="Mirror photos on print" help="On = prints look like the on-screen preview; Off = true orientation (text reads correctly)">
          <Toggle label="Mirror photos" checked={s.mirrorPhotos} onChange={(v) => save({ mirrorPhotos: v })} />
        </Row>
        <Row label="Black & white converts">
          <Segmented label="Black and white scope" value={s.bwWholePrint} options={[{ value: false, label: 'Photos only' }, { value: true, label: 'Whole print' }]} onChange={(v) => { save({ bwWholePrint: v }); clearThumbCache(); }} />
        </Row>
      </Panel>
      <Panel title="Timings">
        <Row label="Return to start when idle (before payment)"><Stepper value={s.inactivitySeconds} min={20} max={600} step={10} suffix=" s" onChange={(v) => save({ inactivitySeconds: v })} /></Row>
        <Row label="Payment time limit"><Stepper value={s.paymentTimeoutSeconds} min={60} max={900} step={30} suffix=" s" onChange={(v) => save({ paymentTimeoutSeconds: v })} /></Row>
        <Row label="Auto-print after preview"><Stepper value={s.previewAutoPrintSeconds} min={5} max={120} step={5} suffix=" s" onChange={(v) => save({ previewAutoPrintSeconds: v })} /></Row>
      </Panel>
      <Panel title="Photo privacy" subtitle="Print files stay on the tablet for reprints and are deleted automatically. The copy sent to the printer is end-to-end encrypted and removed from the cloud within seconds.">
        <Row label="Delete print files on the tablet">
          <select value={s.retentionMinutes} onChange={(e) => save({ retentionMinutes: Number(e.target.value) })}>
            <option value={0}>Immediately after printing</option>
            <option value={10}>10 minutes after printing</option>
            <option value={30}>30 minutes after printing</option>
            <option value={60}>1 hour after printing</option>
            <option value={180}>3 hours after printing</option>
          </select>
        </Row>
      </Panel>
      <Panel title="Booth PINs" subtitle="Operator PIN: resume / reprint orders, cash payments, paper. Admin PIN: the same on the tablet. Defaults are 2580 (admin) and 1470 (operator) – change them.">
        <div className="row-gap start">
          <button className="btn btn-soft btn-sm" onClick={() => setPinFor('admin')}>Change admin PIN</button>
          <button className="btn btn-soft btn-sm" onClick={() => setPinFor('operator')}>Change operator PIN</button>
        </div>
      </Panel>
      {pinFor && <PinDialog boothId={boothId} role={pinFor} otherHash={pinFor === 'admin' ? data.pins.operatorHash : data.pins.adminHash} onClose={() => setPinFor(null)} />}
    </>
  );
}

function PinDialog({ boothId, role, otherHash, onClose }: { boothId: string; role: 'admin' | 'operator'; otherHash?: string; onClose: () => void }) {
  const toast = useToast();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(a)) return setError('Use 4 to 8 digits.');
    if (a !== b) return setError('The PINs do not match.');
    if (a === DEFAULT_ADMIN_PIN || a === DEFAULT_OPERATOR_PIN) return setError('Choose a PIN other than the published defaults.');
    const h = await hashPin(a);
    if (h === otherHash) return setError('Admin and operator PINs must be different.');
    setBusy(true);
    try {
      await update(ref(db, `booths/${boothId}/pins`), { [role === 'admin' ? 'adminHash' : 'operatorHash']: h });
      toast('PIN changed.');
      onClose();
    } catch {
      setError('Could not save the PIN. Check your connection.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`New ${role} PIN`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form className="dialog card" onSubmit={(e) => void save(e)}>
        <h2>New {role} PIN</h2>
        <label>New PIN<input type="password" inputMode="numeric" maxLength={8} autoFocus value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} /></label>
        <label>Repeat PIN<input type="password" inputMode="numeric" maxLength={8} value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="row-gap end">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save PIN'}</button>
        </div>
      </form>
    </div>
  );
}
