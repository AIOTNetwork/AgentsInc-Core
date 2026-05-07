const lastSweepAt = new Map<string, number>();

export const DEFAULT_MANUAL_SWEEP_MIN_INTERVAL_MS = 30_000;

export interface SweepLockResult {
  acquired: boolean;
  retryAfterSeconds: number;
}

export function tryAcquireSweepLock(
  key: string,
  now: number = Date.now(),
  minIntervalMs: number = DEFAULT_MANUAL_SWEEP_MIN_INTERVAL_MS,
): SweepLockResult {
  const last = lastSweepAt.get(key);
  if (last !== undefined && now - last < minIntervalMs) {
    return {
      acquired: false,
      retryAfterSeconds: Math.ceil((minIntervalMs - (now - last)) / 1000),
    };
  }
  lastSweepAt.set(key, now);
  return { acquired: true, retryAfterSeconds: 0 };
}

export function resetSweepLockForTests() {
  lastSweepAt.clear();
}
