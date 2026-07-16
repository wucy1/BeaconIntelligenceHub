/** Effective connectivity: navigator.onLine + same-origin reachability probes. */

const PROBE_TIMEOUT_MS = 2000;
const FAIL_THRESHOLD = 2;
const INTERVAL_ONLINE_MS = 12_000;
const INTERVAL_OFFLINE_MS = 5_000;

type Listener = (online: boolean) => void;

let effectiveOnline =
  typeof navigator !== 'undefined' ? navigator.onLine : true;
let failStreak = 0;
let probeTimer: ReturnType<typeof setInterval> | null = null;
let probing = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(effectiveOnline);
}

function setEffective(next: boolean): void {
  if (effectiveOnline === next) return;
  effectiveOnline = next;
  notify();
  restartTimer();
}

async function probeReachability(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Cache-bust so Service Worker precache does not fake a success while offline.
    const url = `/manifest.webmanifest?bih_probe=${Date.now()}`;
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function runProbe(): Promise<void> {
  if (probing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    failStreak = FAIL_THRESHOLD;
    setEffective(false);
    return;
  }
  probing = true;
  try {
    const ok = await probeReachability();
    if (ok) {
      failStreak = 0;
      setEffective(true);
    } else {
      failStreak += 1;
      if (failStreak >= FAIL_THRESHOLD) setEffective(false);
    }
  } finally {
    probing = false;
  }
}

function restartTimer(): void {
  if (probeTimer != null) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
  if (typeof window === 'undefined') return;
  const ms = effectiveOnline ? INTERVAL_ONLINE_MS : INTERVAL_OFFLINE_MS;
  probeTimer = setInterval(() => {
    void runProbe();
  }, ms);
}

function onBrowserOnline(): void {
  failStreak = 0;
  void runProbe();
}

function onBrowserOffline(): void {
  failStreak = FAIL_THRESHOLD;
  setEffective(false);
}

let started = false;

function ensureStarted(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', onBrowserOnline);
  window.addEventListener('offline', onBrowserOffline);
  restartTimer();
  void runProbe();
}

/** Current effective online flag (may lag a probe cycle behind reality). */
export function isEffectivelyOnline(): boolean {
  ensureStarted();
  return effectiveOnline;
}

/** Subscribe to effective connectivity changes. Returns unsubscribe. */
export function subscribeEffectiveOnline(listener: Listener): () => void {
  ensureStarted();
  listeners.add(listener);
  listener(effectiveOnline);
  return () => {
    listeners.delete(listener);
  };
}

/** Force an immediate probe (e.g. after a failed tile burst). */
export function checkConnectivityNow(): void {
  ensureStarted();
  void runProbe();
}
