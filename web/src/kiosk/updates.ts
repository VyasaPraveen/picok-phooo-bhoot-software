/**
 * A new app version is applied only between customers: the service worker reports it, and the
 * booth reloads the next time it is back on the start screen (never during payment or printing).
 */
let pending = false;
const listeners = new Set<() => void>();

export function markUpdateReady() {
  pending = true;
  listeners.forEach((l) => l());
}

export const updateReady = () => pending;

export function onUpdateReady(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
