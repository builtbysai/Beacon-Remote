// Do not open a viewer from a request whose page/authentication context ended.
export async function resolveViewRequest<T>(
  request: Promise<T>,
  isCurrent: () => boolean,
  accept: (grant: T) => void,
  discard: (grant: T) => Promise<unknown>,
): Promise<void> {
  let grant: T;
  try {
    grant = await request;
  } catch (failure) {
    if (isCurrent()) throw failure;
    return;
  }
  if (isCurrent()) {
    accept(grant);
    return;
  }
  // Logout or a network failure can make this best-effort stop unavailable.
  // Original server/native expiry and local consent still apply.
  await discard(grant).catch(() => {});
}
