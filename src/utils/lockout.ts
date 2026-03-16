import { stateRepository } from '@/state/repositories';

export const MAX_ATTEMPTS = 3;
export const LOCKOUT_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export function checkLockout(): { locked: boolean; remainingMs?: number } {
  const state = stateRepository.getState();
  const { lockedUntil } = state.adminLockout;
  if (!lockedUntil) return { locked: false };

  const expiry = new Date(lockedUntil).getTime();
  const now = Date.now();

  if (now < expiry) {
    return { locked: true, remainingMs: expiry - now };
  }

  // Lock expired — auto-clear
  state.adminLockout.failedAttempts = 0;
  state.adminLockout.lockedUntil = null;
  void stateRepository.write().catch((error: unknown) => {
    console.error('Failed to persist admin lockout auto-clear', error);
  });
  return { locked: false };
}

export async function recordFailedAttempt(): Promise<number> {
  const state = stateRepository.getState();
  state.adminLockout.failedAttempts += 1;
  const attempts = state.adminLockout.failedAttempts;

  if (attempts >= MAX_ATTEMPTS) {
    state.adminLockout.lockedUntil = new Date(
      Date.now() + LOCKOUT_DURATION_MS,
    ).toISOString();
  }

  await stateRepository.write();
  return attempts;
}

export async function clearLockout(): Promise<void> {
  const state = stateRepository.getState();
  state.adminLockout.failedAttempts = 0;
  state.adminLockout.lockedUntil = null;
  await stateRepository.write();
}

export function formatRemainingTime(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
}
