// Serialises concurrent balance/earnings mutations for payment endpoints.
let balanceLockPromise = Promise.resolve();

export async function withBalanceLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = balanceLockPromise;
  let release: () => void;
  balanceLockPromise = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}
