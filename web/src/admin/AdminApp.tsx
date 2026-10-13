import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { get, onValue, ref, serverTimestamp, set, update } from 'firebase/database';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ensureFonts } from '../render';
import { useBoothData, useLogo } from '../shared/booth';
import { DEFAULT_ADMIN_PIN, DEFAULT_OPERATOR_PIN, hashPin } from '../shared/crypto';
import { auth, db, DEFAULT_BOOTH_ID, OWNER_EMAIL } from '../shared/firebase';
import { DEFAULT_SETTINGS, settingsForDb } from '../shared/model';
import { RenderEnvContext, type RenderEnv } from '../shared/Thumb';
import { ToastProvider, useToast } from '../shared/ui';
import { AdminsSection, DevicesSection } from './sections/Access';
import { BrandingSection, PricesSection } from './sections/Branding';
import { OrdersSection, OverviewSection, SalesSection } from './sections/Sales';
import { BoothSettingsSection, PaperSection } from './sections/Setup';
import { TemplatesSection } from './sections/Templates';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: '◎' },
  { id: 'orders', label: 'Orders', icon: '☰' },
  { id: 'sales', label: 'Sales report', icon: '₹' },
  { id: 'brand', label: 'Event & brand', icon: '★' },
  { id: 'prices', label: 'Prices', icon: '⊞' },
  { id: 'templates', label: 'Templates', icon: '▦' },
  { id: 'paper', label: 'Paper & printer', icon: '⎙' },
  { id: 'booth', label: 'Booth settings', icon: '⚙' },
  { id: 'devices', label: 'Devices', icon: '⌁' },
  { id: 'admins', label: 'Admins', icon: '⚑' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export function AdminApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);
  useEffect(() => {
    if (!user || user.isAnonymous) {
      setIsAdmin(undefined);
      return;
    }
    return onValue(
      ref(db, `admins/${user.uid}`),
      (s) => setIsAdmin(s.val() === true),
      () => setIsAdmin(false),
    );
  }, [user]);

  let body;
  if (user === undefined) body = <Loading />;
  else if (!user || user.isAnonymous) body = <SignIn />;
  else if (isAdmin === undefined) body = <Loading />;
  else if (!isAdmin) body = <NotAdmin user={user} />;
  else body = <Dashboard user={user} />;
  return <ToastProvider>{body}</ToastProvider>;
}

function Loading() {
  return (
    <div className="auth-screen"><div className="spinner" aria-label="Loading" /></div>
  );
}

function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'in') await signInWithEmailAndPassword(auth, email.trim(), password);
      else await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setError(
        code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')
          ? 'Wrong email or password.'
          : code.includes('email-already-in-use')
            ? 'This email already has an account. Sign in instead.'
            : code.includes('weak-password')
              ? 'Use a password of at least 8 characters.'
              : code.includes('operation-not-allowed') || code.includes('configuration-not-found')
                ? 'Email sign-in is not enabled for this Firebase project yet (Authentication → Sign-in method).'
                : 'Could not sign in. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) return setError('Enter your email first.');
    await sendPasswordResetEmail(auth, email.trim()).catch(() => undefined);
    setInfo('If an account exists, a password reset email is on its way.');
  };

  return (
    <div className="auth-screen">
      <form className="auth-card card" onSubmit={submit}>
        <img src="/brand/picok_logo_transparent.png" alt="Picok" />
        <h1>Booth admin</h1>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'up' ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        {info && <p className="dim" role="status">{info}</p>}
        <button className="btn btn-primary" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        <div className="auth-links">
          <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
            {mode === 'in' ? 'First time? Create an account' : 'Have an account? Sign in'}
          </button>
          {mode === 'in' && <button type="button" className="link" onClick={() => void reset()}>Forgot password?</button>}
        </div>
      </form>
    </div>
  );
}

function NotAdmin({ user }: { user: User }) {
  const [requested, setRequested] = useState(false);
  const [verified, setVerified] = useState(user.emailVerified);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const owner = user.email?.toLowerCase() === OWNER_EMAIL;

  useEffect(() => {
    void get(ref(db, `adminRequests/${user.uid}`)).then((s) => setRequested(s.exists())).catch(() => undefined);
  }, [user.uid]);

  const activate = async () => {
    setError('');
    try {
      await set(ref(db, `admins/${user.uid}`), true);
    } catch {
      setError('Could not activate. Check that the database rules are deployed.');
    }
  };
  // The owner proves the mailbox is theirs before the rules accept self-activation.
  const sendVerification = async () => {
    setError('');
    try {
      await sendEmailVerification(user);
      setInfo(`A verification link was sent to ${user.email}. Open it, then tap “I’ve verified”.`);
    } catch {
      setError('Could not send the email. Wait a minute and try again.');
    }
  };
  const recheck = async () => {
    setError('');
    try {
      await user.reload();
      await user.getIdToken(true);
      if (auth.currentUser?.emailVerified) setVerified(true);
      else setError('Not verified yet. Open the link in the email first.');
    } catch {
      setError('Could not check. Check your connection.');
    }
  };
  const request = async () => {
    setError('');
    try {
      await set(ref(db, `adminRequests/${user.uid}`), { email: user.email, createdAt: serverTimestamp() });
      setRequested(true);
    } catch {
      setError('Could not send the request. Check your connection and try again.');
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card card">
        <img src="/brand/picok_logo_transparent.png" alt="Picok" />
        <h1>Hello, {user.email}</h1>
        {owner && !verified ? (
          <>
            <p className="dim">You are the owner of this booth system. First confirm this email address is yours.</p>
            <button className="btn btn-primary" onClick={() => void sendVerification()}>Send verification email</button>
            <button className="btn btn-soft" onClick={() => void recheck()}>I’ve verified</button>
          </>
        ) : owner ? (
          <>
            <p className="dim">You are the owner of this booth system. Activate your admin access to continue.</p>
            <button className="btn btn-primary" onClick={() => void activate()}>Activate admin access</button>
          </>
        ) : requested ? (
          <p className="dim">Your access request is waiting for an existing admin to approve it (Admins page).</p>
        ) : (
          <>
            <p className="dim">This account is not an admin yet.</p>
            <button className="btn btn-primary" onClick={() => void request()}>Request admin access</button>
          </>
        )}
        {info && <p className="dim" role="status">{info}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn btn-ghost btn-sm" onClick={() => void signOut(auth)}>Sign out</button>
      </div>
    </div>
  );
}

/** Creates the booth with safe defaults the first time an admin signs in. */
async function ensureBooth(boothId: string) {
  const s = await get(ref(db, `booths/${boothId}/settings`));
  if (s.exists()) return;
  const [adminHash, operatorHash] = await Promise.all([hashPin(DEFAULT_ADMIN_PIN), hashPin(DEFAULT_OPERATOR_PIN)]);
  await update(ref(db, `booths/${boothId}`), {
    info: { name: 'Picok Booth 1', createdAt: Date.now() },
    settings: settingsForDb(DEFAULT_SETTINGS),
    pins: { adminHash, operatorHash },
    state: { printsRemaining: 700, loadedRoll: '4x6', updatedAt: Date.now() },
  });
}

function Dashboard({ user }: { user: User }) {
  const boothId = DEFAULT_BOOTH_ID;
  const [section, setSection] = useState<SectionId>(() => {
    const h = location.hash.slice(2) as SectionId;
    return SECTIONS.some((s) => s.id === h) ? h : 'overview';
  });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();
  const data = useBoothData(boothId);
  const logo = useLogo(boothId, data.settings.logoAssetId);
  const env = useMemo<RenderEnv>(() => ({ boothId, settings: data.settings, logo }), [data.settings, logo]);

  useEffect(() => {
    void Promise.all([ensureBooth(boothId), ensureFonts()])
      .then(() => setReady(true))
      .catch(() => setLoadError(true));
    // Lets the Admins page show who each admin is.
    if (user.email) void set(ref(db, `adminProfiles/${user.uid}`), { email: user.email }).catch(() => undefined);
  }, [boothId, user]);

  // Any save that the server refuses or that fails is reported, never silently lost.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = String((e.reason as { message?: string } | undefined)?.message ?? e.reason ?? '');
      toast(/permission.denied/i.test(msg) ? 'Not saved: permission denied.' : 'Not saved. Check your connection and try again.', true);
    };
    addEventListener('unhandledrejection', onRejection);
    return () => removeEventListener('unhandledrejection', onRejection);
  }, [toast]);

  const open = (id: SectionId) => {
    setSection(id);
    setMenuOpen(false);
    history.replaceState(null, '', `#/${id}`);
  };

  if (loadError) {
    return (
      <div className="auth-screen">
        <div className="auth-card card">
          <h1>Could not load the booth</h1>
          <p className="dim">Check your connection, then try again.</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
          <button className="btn btn-ghost btn-sm" onClick={() => void signOut(auth)}>Sign out</button>
        </div>
      </div>
    );
  }
  if (!ready || !data.loaded) return <Loading />;
  const props = { boothId, data };
  return (
    <RenderEnvContext.Provider value={env}>
      <div className="admin">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="brand">
            <img src="/brand/picok_logo_transparent.png" alt="Picok" />
            <span>Admin</span>
          </div>
          <nav>
            {SECTIONS.map((s) => (
              <button key={s.id} aria-current={section === s.id ? 'page' : undefined} onClick={() => open(s.id)}>
                <span aria-hidden>{s.icon}</span> {s.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <a className="btn btn-soft btn-sm" href="/" target="_blank" rel="noreferrer">Open kiosk ↗</a>
            <span className="dim small">{user.email}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => void signOut(auth)}>Sign out</button>
          </div>
        </aside>
        {menuOpen && <div className="sidebar-scrim" aria-hidden onClick={() => setMenuOpen(false)} />}
        <main className="admin-main">
          <header className="admin-top">
            <button className="menu-btn" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>☰</button>
            <h1>{SECTIONS.find((s) => s.id === section)?.label}</h1>
            {(data.settings.paymentMode === 'demo' || data.settings.printMode === 'demo') && (
              <button className="demo-pill" onClick={() => open('booth')}>DEMO MODE</button>
            )}
          </header>
          <div className="admin-content" key={section}>
            {section === 'overview' && <OverviewSection {...props} />}
            {section === 'orders' && <OrdersSection {...props} />}
            {section === 'sales' && <SalesSection {...props} />}
            {section === 'brand' && <BrandingSection {...props} />}
            {section === 'prices' && <PricesSection {...props} />}
            {section === 'templates' && <TemplatesSection {...props} />}
            {section === 'paper' && <PaperSection {...props} />}
            {section === 'booth' && <BoothSettingsSection {...props} />}
            {section === 'devices' && <DevicesSection {...props} />}
            {section === 'admins' && <AdminsSection />}
          </div>
        </main>
      </div>
    </RenderEnvContext.Provider>
  );
}
