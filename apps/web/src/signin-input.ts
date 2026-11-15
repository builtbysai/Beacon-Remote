import {
  inputEnvelope,
  signinDisplay,
  signinScopeContext,
  signinAttentionInput,
  signinAttentionResult,
  type SignInContext,
} from "@beacon-remote/protocol";

export type SignInInputScope = SignInContext & {
  live: () => boolean;
  attentionState?: (pending: boolean) => void;
};
export function signInAttentionReply(
  raw: string,
  scope: SignInContext,
  sequence: number,
) {
  try {
    if (new TextEncoder().encode(raw).length > 4096) return null;
    const parsed = signinAttentionResult.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const reply = parsed.data;
    return reply.leaseId === scope.leaseId &&
      reply.instanceId === scope.instanceId &&
      reply.consoleSessionId === scope.consoleSessionId &&
      reply.sequence === sequence
      ? reply
      : null;
  } catch {
    return null;
  }
}
export function signInDisplay(raw: string, scope: SignInContext) {
  try {
    if (new TextEncoder().encode(raw).length > 4096) return null;
    const parsed = signinDisplay.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const display = parsed.data;
    if (
      display.leaseId !== scope.leaseId ||
      display.instanceId !== scope.instanceId ||
      display.consoleSessionId !== scope.consoleSessionId
    )
      return null;
    return display;
  } catch {
    return null;
  }
}
export function signInInput(
  scope: SignInInputScope,
  sequence: number,
  input: Record<string, unknown>,
): string {
  if (!scope.live()) throw new Error("Sign-in input ended");
  if (
    sequence < 1 ||
    !signinScopeContext.safeParse({
      scope: "windows:sign-in",
      leaseId: scope.leaseId,
      instanceId: scope.instanceId,
      consoleSessionId: scope.consoleSessionId,
    }).success
  )
    throw new Error("Invalid sign-in input context");
  const parsed = inputEnvelope.safeParse({
    version: 1,
    sessionId: scope.leaseId,
    leaseId: scope.leaseId,
    sequence,
    input,
  });
  const attention = signinAttentionInput.safeParse(input);
  const event = parsed.success
    ? parsed.data.input
    : attention.success
      ? attention.data
      : null;
  if (
    !event ||
    !Number.isSafeInteger(sequence) ||
    event.type === "clipboard_read" ||
    event.type === "nav"
  )
    throw new Error("Unsupported sign-in input");
  const body = JSON.stringify({
    version: 1,
    scope: "windows:sign-in",
    leaseId: scope.leaseId,
    instanceId: scope.instanceId,
    consoleSessionId: scope.consoleSessionId,
    sequence,
    input: event,
  });
  if (new TextEncoder().encode(body).length > 4096)
    throw new Error("Sign-in input too large");
  return body;
}
