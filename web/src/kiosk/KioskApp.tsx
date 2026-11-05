import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { get, onValue, ref, remove, serverTimestamp, set } from 'firebase/database';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ensureFonts } from '../render';
import { pruneAssetCache, referencedAssets, screenLogo, useBoothData, useLogo, useSamplePhotos } from '../shared/booth';
import { auth, db, serverNow } from '../shared/firebase';
import { RenderEnvContext, type RenderEnv } from '../shared/Thumb';
import { ToastProvider } from '../shared/ui';
import { watchLatePayments } from './boothOps';
import { Flow } from './Flow';

interface DeviceRecord {
  boothId: string;
  role: 'kiosk' | 'bridge';
  name?: string;
}

/** Signs the tablet in, pairs it with a booth once, then runs the booth. */
export function KioskApp() {
  const [uid, setUid] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceRecord | null | undefined>(undefined);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        if (u) {
          setUid(u.uid);
          return;
        }
        signInAnonymously(auth).catch((e: { code?: string }) =>
          setFatal(
            e.code === 'auth/admin-restricted-operation' || e.code === 'auth/operation-not-allowed'
              ? 'Anonymous sign-in is not enabled in this Firebase project yet (Authentication → Sign-in method → Anonymous).'
              : 'Cannot reach the booth server. Check the internet connection.',
          ),
        );
      }),
    [],
  );

  useEffect(() => {
    if (!uid) return;
    return onValue(
      ref(db, `devices/${uid}`),
      (s) => setDevice((s.val() as DeviceRecord | null) ?? null),
      () => setDevice(null),
    );
  }, [uid]);

  let body;
  if (fatal) body = <Message title="Booth setup needed" text={fatal} />;
  else if (!uid || device === undefined) body = <Splash />;
  else if (!device || device.role !== 'kiosk') {
    applyTheme('dark');
    body = <Pairing uid={uid} />;
  }
  else body = <BoothRoot boothId={device.boothId} />;
  return <ToastProvider>{body}</ToastProvider>;
}

function BoothRoot({ boothId }: { boothId: string }) {
  const data = useBoothData(boothId);
  const logo = useLogo(boothId, data.settings.logoAssetId, data.settings.logoLightAssetId);
  const samples = useSamplePhotos(boothId, data.settings.samplePhotoAssetIds);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    void ensureFonts().finally(() => setFontsReady(true));
    // Paired: the dashboard removed the code; drop our copy too.
    const c = localStorage.getItem(CODE_KEY);
    if (c) {
      localStorage.removeItem(CODE_KEY);
      void remove(ref(db, `pairing/${c}`)).catch(() => undefined);
    }
  }, []);
  useEffect(() => watchLatePayments(boothId), [boothId]);
  // Once everything has loaded, drop cached images the booth no longer uses (old logos, frames).
  const latest = useRef(data);
  latest.current = data;
  useEffect(() => {
    const t = setTimeout(() => {
      if (latest.current.loaded) void pruneAssetCache(boothId, referencedAssets(latest.current.settings, latest.current.templates));
    }, 60_000);
    return () => clearTimeout(t);
  }, [boothId]);
  const env = useMemo<RenderEnv>(() => ({ boothId, settings: data.settings, logo, samples }), [boothId, data.settings, logo, samples]);
  // The event's theme drives the booth screens (theme.css) as well as the prints. It is applied
  // before the screens render (they pick the matching logo) and remembered for the next start-up.
  const theme = data.settings.theme;
  if (data.loaded) applyTheme(theme);
  if (!data.loaded || !fontsReady || !logo.logo) return <Splash />;
  return (
    <RenderEnvContext.Provider value={env}>
      <Flow boothId={boothId} data={data} />
    </RenderEnvContext.Provider>
  );
}

const THEME_KEY = 'picok.theme';

/** Sets <html data-theme> (idempotent, so it may run during render) and remembers it. */
function applyTheme(theme: 'dark' | 'light') {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f5fa' : '#07070b');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the booth starts dark until its settings load.
  }
}

/** The theme of the last event, so the splash screen does not flash dark on a light booth. */
export function restoreTheme() {
  try {
    if (localStorage.getItem(THEME_KEY) === 'light') document.documentElement.dataset.theme = 'light';
  } catch {
    // Default dark.
  }
}

const CODE_KEY = 'picok.pairingCode';
/** The tablet renews its code after 10 minutes; the dashboard accepts codes up to 15 minutes old. */
const CODE_LIFETIME_MS = 10 * 60_000;

/** Shows a 6-digit code; the admin enters it in the dashboard (Devices → Pair) to link this tablet. */
function Pairing({ uid }: { uid: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Codes expire (the dashboard refuses old ones), so a fresh code is shown every few minutes.
    const renewIn = (ms: number) => {
      timer = setTimeout(() => void claim(), Math.max(5_000, ms));
    };
    const claim = async () => {
      const saved = localStorage.getItem(CODE_KEY);
      if (saved) {
        const s = await get(ref(db, `pairing/${saved}`)).catch(() => null);
        const p = s?.val() as { uid?: string; createdAt?: number } | null;
        const age = serverNow() - (p?.createdAt ?? 0);
        if (p?.uid === uid && age < CODE_LIFETIME_MS) {
          if (alive) setCode(saved);
          renewIn(CODE_LIFETIME_MS - age);
          return;
        }
        if (p?.uid === uid) await remove(ref(db, `pairing/${saved}`)).catch(() => undefined);
        localStorage.removeItem(CODE_KEY);
      }
      for (let i = 0; i < 8 && alive; i++) {
        const c = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
        try {
          await set(ref(db, `pairing/${c}`), { uid, role: 'kiosk', name: 'Booth tablet', createdAt: serverTimestamp() });
          localStorage.setItem(CODE_KEY, c);
          if (alive) {
            setCode(c);
            setError(null);
          }
          renewIn(CODE_LIFETIME_MS);
          return;
        } catch {
          // Code already taken – try another.
        }
      }
      if (alive) setError('Could not create a pairing code. Check the internet connection and reload.');
    };
    void claim();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [uid]);

  const admin = `${location.origin}/admin`;
  return (
    <div className="center-screen">
      <img src={screenLogo()} alt="Picok" className="pair-logo" />
      <h1>Connect this tablet to your booth</h1>
      {error ? (
        <p className="error-text">{error}</p>
      ) : code ? (
        <>
          <p className="dim">In the admin dashboard, open <b>Devices → Pair a device</b> and enter:</p>
          <div className="pair-code" aria-label={`Pairing code ${code.split('').join(' ')}`}>
            {code.slice(0, 3)} {code.slice(3)}
          </div>
          <p className="dim">{admin}</p>
          <div className="spinner" aria-hidden />
          <p className="dim">Waiting for approval…</p>
        </>
      ) : (
        <div className="spinner" aria-label="Loading" />
      )}
    </div>
  );
}

function Splash() {
  return (
    <div className="center-screen">
      <img src={screenLogo()} alt="Picok" className="pair-logo" />
      <div className="spinner" aria-label="Loading" />
    </div>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="center-screen">
      <img src={screenLogo()} alt="Picok" className="pair-logo" />
      <h1>{title}</h1>
      <p className="dim" style={{ maxWidth: 640, textAlign: 'center' }}>{text}</p>
      <button className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
    </div>
  );
}
