// A tab-local identifier, never a desktop credential or renewed consent.
const key = "beacon-remote:active-view";
export type RememberedView = { id: string; name: string };
export function readView(): RememberedView | null {
  try {
    const record = JSON.parse(
      window.sessionStorage.getItem(key) ?? "null",
    ) as RememberedView;
    return record &&
      typeof record.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        record.id,
      ) &&
      typeof record.name === "string" &&
      record.name.length <= 254
      ? record
      : null;
  } catch {
    return null;
  }
}
export function rememberView(view: RememberedView) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(view));
  } catch {
    /* Reload recovery is optional when storage is unavailable. */
  }
}
export function forgetView() {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* Server/native termination still applies. */
  }
}
