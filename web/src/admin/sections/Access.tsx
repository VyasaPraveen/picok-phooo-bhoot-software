import { get, onValue, ref, remove, update } from 'firebase/database';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { auth, db, serverNow } from '../../shared/firebase';
import { bridgeOnline } from '../../shared/model';
import { Segmented, useToast } from '../../shared/ui';
import { fmtDateTime, Panel, type SectionProps } from '../fields';

/** Codes older than this are refused (the devices renew theirs every 10 minutes). */
const CODE_MAX_AGE_MS = 15 * 60_000;

interface Device {
  boothId: string;
  role: 'kiosk' | 'bridge';
  name?: string;
  pairedAt?: number;
}

export function DevicesSection({ boothId, data }: SectionProps) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [role, setRole] = useState<'kiosk' | 'bridge'>('kiosk');
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<[string, Device][]>([]);
  const [qr, setQr] = useState<string | null>(null);
  const kioskUrl = location.origin;

  useEffect(() => {
    void QRCode.toDataURL(kioskUrl, { width: 320, margin: 1 }).then(setQr);
    return onValue(ref(db, 'devices'), (s) => {
      const all = (s.val() as Record<string, Device> | null) ?? {};
      setDevices(Object.entries(all).filter(([, d]) => d.boothId === boothId));
    });
  }, [boothId, kioskUrl]);

  const pair = async () => {
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) return toast('Enter the 6-digit code shown on the device.', true);
    setBusy(true);
    try {
      const snap = await get(ref(db, `pairing/${c}`));
      const p = snap.val() as { uid?: string; role?: 'kiosk' | 'bridge'; name?: string; createdAt?: number } | null;
      // The admin says what they are pairing, so a code typed by mistake can never add a device of another kind.
      if (!p?.uid || p.role !== role || serverNow() - (p.createdAt ?? 0) > CODE_MAX_AGE_MS) {
        toast(`No ${role === 'kiosk' ? 'booth tablet' : 'print PC'} is waiting with that code. Check the code on its screen.`, true);
        return;
      }
      const patch: Record<string, unknown> = {
        [`devices/${p.uid}`]: { boothId, role: p.role, name: (p.name ?? p.role).slice(0, 60), pairedAt: Date.now() },
        [`pairing/${c}`]: null,
      };
      if (role === 'bridge') {
        // One print PC per booth: the new PC replaces the old one and publishes its own key.
        for (const [uid, d] of devices) if (d.role === 'bridge' && uid !== p.uid) patch[`devices/${uid}`] = null;
        patch[`booths/${boothId}/bridge/publicKey`] = null;
      }
      await update(ref(db), patch);
      setCode('');
      toast(`${p.role === 'kiosk' ? 'Booth tablet' : 'Print PC'} paired. It connects within a few seconds.`);
    } catch {
      toast('Pairing failed. Check your connection.', true);
    } finally {
      setBusy(false);
    }
  };

  const unpair = async (uid: string, d: Device) => {
    if (!confirm(`Unpair “${d.name ?? d.role}”? It will stop working until it is paired again.`)) return;
    try {
      await update(ref(db), {
        [`devices/${uid}`]: null,
        // The next print PC paired for this booth publishes its own key.
        ...(d.role === 'bridge' ? { [`booths/${boothId}/bridge/publicKey`]: null } : {}),
      });
      toast('Device unpaired.');
    } catch {
      toast('Could not unpair. Check your connection.', true);
    }
  };

  const online = bridgeOnline(data.bridge);
  return (
    <>
      <Panel title="Pair a device" subtitle="The booth tablet and the Print Bridge PC each show a 6-digit code the first time they start.">
        <Segmented
          label="Device to pair"
          value={role}
          options={[
            { value: 'kiosk', label: '📱 Booth tablet' },
            { value: 'bridge', label: '🖨 Print PC' },
          ]}
          onChange={setRole}
        />
        <div className="pair-row">
          <input
            type="text"
            inputMode="numeric"
            maxLength={7}
            placeholder="123 456"
            aria-label="Pairing code"
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void pair()}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => void pair()}>Pair</button>
        </div>
      </Panel>
      <Panel title="Paired devices">
        {devices.length === 0 && <p className="dim">No devices paired yet.</p>}
        {devices.map(([uid, d]) => (
          <div key={uid} className="order-line">
            <div>
              <strong>{d.role === 'kiosk' ? '📱 Booth tablet' : '🖨 Print PC'}</strong> <span className="dim">· {d.name ?? ''}</span>
              <div className="dim small">
                Paired {d.pairedAt ? fmtDateTime(d.pairedAt) : '—'}
                {d.role === 'bridge' ? ` · ${online ? 'online' : 'offline'}` : ''}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => void unpair(uid, d)}>Unpair</button>
          </div>
        ))}
      </Panel>
      <Panel title="Set up the booth tablet" subtitle="Install the booth as an app on the Galaxy Tab in under a minute.">
        <div className="install">
          {qr && <img src={qr} alt={`QR code for ${kioskUrl}`} />}
          <ol>
            <li>Scan this QR code with the tablet, or open <b>{kioskUrl}</b> in Chrome.</li>
            <li>Chrome menu ⋮ → <b>Install app</b> (or Add to Home screen).</li>
            <li>Open <b>Picok Booth</b> from the home screen and allow the camera.</li>
            <li>Enter the 6-digit code it shows in “Pair a device” above.</li>
            <li>Lock it to the booth: Settings → Security → <b>Pin app</b> on, then pin Picok Booth from Recents.</li>
          </ol>
        </div>
      </Panel>
    </>
  );
}

export function AdminsSection() {
  const toast = useToast();
  const [requests, setRequests] = useState<[string, { email?: string; createdAt?: number }][]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const me = auth.currentUser?.uid;

  useEffect(() => {
    const a = onValue(ref(db, 'adminRequests'), (s) => setRequests(Object.entries((s.val() as Record<string, { email?: string; createdAt?: number }> | null) ?? {})));
    const b = onValue(ref(db, 'admins'), (s) => setAdmins(Object.keys((s.val() as Record<string, boolean> | null) ?? {})));
    const c = onValue(
      ref(db, 'adminProfiles'),
      (s) => setEmails(Object.fromEntries(Object.entries((s.val() as Record<string, { email?: string }> | null) ?? {}).map(([k, v]) => [k, v.email ?? '']))),
      () => undefined,
    );
    return () => {
      a();
      b();
      c();
    };
  }, []);

  const approve = async (uid: string, email?: string) => {
    try {
      await update(ref(db), { [`admins/${uid}`]: true, [`adminRequests/${uid}`]: null });
      toast(`${email ?? 'User'} is now an admin.`);
    } catch {
      toast('Could not approve. Check your connection.', true);
    }
  };
  const reject = (uid: string) =>
    void remove(ref(db, `adminRequests/${uid}`)).catch(() => toast('Could not reject. Check your connection.', true));
  const revoke = async (uid: string) => {
    if (!confirm(`Remove admin access for ${emails[uid] || 'this admin'}?`)) return;
    try {
      await update(ref(db), { [`admins/${uid}`]: null, [`adminProfiles/${uid}`]: null });
      toast('Admin removed.');
    } catch {
      toast('Could not remove the admin. Check your connection.', true);
    }
  };

  return (
    <>
      <Panel title="Access requests" subtitle="People who created an account on this dashboard and asked for admin access.">
        {requests.length === 0 && <p className="dim">No pending requests.</p>}
        {requests.map(([uid, r]) => (
          <div key={uid} className="order-line">
            <div><strong>{r.email ?? uid}</strong><div className="dim small">{r.createdAt ? fmtDateTime(r.createdAt) : ''}</div></div>
            <span className="row-gap">
              <button className="btn btn-primary btn-sm" onClick={() => void approve(uid, r.email)}>Approve</button>
              <button className="btn btn-ghost btn-sm" onClick={() => reject(uid)}>Reject</button>
            </span>
          </div>
        ))}
      </Panel>
      <Panel title="Admins">
        {admins.map((uid) => (
          <div key={uid} className="order-line">
            <div><strong>{uid === me ? `You (${auth.currentUser?.email})` : emails[uid] || `Admin ${uid.slice(0, 8)}… (signs in to show email)`}</strong></div>
            {uid !== me && <button className="btn btn-ghost btn-sm" onClick={() => void revoke(uid)}>Remove</button>}
          </div>
        ))}
      </Panel>
    </>
  );
}
