// A successful response can recover only the original live authorization.
// Never substitute a new grant or extend its original deadline.
export async function recoverTransport<
  T extends { id: string; expiresAtMillis: number },
>(
  original: T,
  request: () => Promise<T>,
  isCurrent: () => boolean,
  discard: () => Promise<unknown>,
): Promise<T | null> {
  if (!isCurrent()) return null;
  const resumed = await request();
  if (!isCurrent()) {
    await discard().catch(() => {});
    return null;
  }
  if (
    resumed.id !== original.id ||
    resumed.expiresAtMillis !== original.expiresAtMillis
  ) {
    await discard().catch(() => {});
    throw new Error("Recovery changed authorization");
  }
  return resumed;
}
