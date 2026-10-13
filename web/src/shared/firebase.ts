import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, onValue, ref } from 'firebase/database';

/**
 * Firebase web config. These values are public by design: access is controlled by the
 * Realtime Database security rules (database.rules.json). To move to the client's own
 * Firebase project, replace this object and redeploy (see docs/WEB_SETUP.md).
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyCbUHG0KYPy4j0MWDwioWtvgGEHKEP-HZg',
  authDomain: 'picok-booth.firebaseapp.com',
  databaseURL: 'https://picok-booth-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'picok-booth',
  appId: '1:982759343357:web:1aab84b5dabf32cee56a94',
  messagingSenderId: '982759343357',
};

/**
 * The dashboard runs as a separate Firebase app instance so its sign-in never replaces the
 * kiosk's device session when /admin is opened on the booth tablet itself.
 */
export const isAdminPage = location.pathname.startsWith('/admin');
export const app = isAdminPage ? initializeApp(firebaseConfig, 'picok-admin') : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Local testing only: `VITE_EMULATORS=127.0.0.1:9099,127.0.0.1:9000 npm run dev` uses the Firebase emulators.
const emulators = import.meta.env.DEV ? (import.meta.env.VITE_EMULATORS as string | undefined) : undefined;
if (emulators) {
  const [authHost, dbHost] = emulators.split(',');
  const [dbName, dbPort] = dbHost.split(':');
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  connectDatabaseEmulator(db, dbName, Number(dbPort));
}

/** Firebase's clock, so a tablet with a wrong clock still agrees with the server and the print PC. */
let serverOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), (s) => {
  serverOffset = Number(s.val()) || 0;
});
export const serverNow = () => Date.now() + serverOffset;

/** The account allowed to activate itself as the first admin (must match database.rules.json). */
export const OWNER_EMAIL = 'praveenkrishna548@gmail.com';

/** The booth every device and the dashboard work with (multi-booth ready in the data model). */
export const DEFAULT_BOOTH_ID = 'booth-1';
