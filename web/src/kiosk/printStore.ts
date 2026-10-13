/**
 * Print files kept on this tablet only (IndexedDB) so a paid order can be reprinted after a paper jam.
 * They are deleted automatically after the retention time set in the dashboard.
 */
interface StoredPrint {
  orderId: string;
  blob: Blob;
  createdAt: number;
  printedAt: number | null;
}

const DB = 'picok-booth';
const STORE = 'prints';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'orderId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export const savePrint = (orderId: string, blob: Blob) =>
  tx('readwrite', (s) => s.put({ orderId, blob, createdAt: Date.now(), printedAt: null } satisfies StoredPrint));

export const getPrint = (orderId: string) => tx<StoredPrint | undefined>('readonly', (s) => s.get(orderId));

export async function markPrinted(orderId: string) {
  const p = await getPrint(orderId);
  if (p) await tx('readwrite', (s) => s.put({ ...p, printedAt: Date.now() }));
}

export const deletePrint = (orderId: string) => tx('readwrite', (s) => s.delete(orderId));

/** Deletes printed files older than the retention time, and anything older than 24 h. */
export async function purgePrints(retentionMinutes: number) {
  const all = await tx<StoredPrint[]>('readonly', (s) => s.getAll());
  const now = Date.now();
  for (const p of all) {
    const printedExpired = p.printedAt !== null && now - p.printedAt >= retentionMinutes * 60_000;
    const stale = now - p.createdAt > 24 * 3600_000;
    if (printedExpired || stale) await deletePrint(p.orderId);
  }
}
