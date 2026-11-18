import {
  viewerPermissionSignal,
  type SessionPermission,
  type SessionPermissionSignal,
} from "@beacon-remote/protocol";

export const permissionNames: Record<SessionPermission, string> = {
  control: "Control",
  files: "File transfer",
  audio: "Device sound",
  recording: "Recording",
  drive: "Shared folder",
};

export type PermissionRequestView = {
  options: SessionPermission[];
  status: string;
  busy: boolean;
  canCancel: boolean;
};

const outcomes = {
  approved:
    "Approved on the device. Access appears when the device enables it.",
  denied: "The device declined the request.",
  cancelled: "Request cancelled.",
  expired: "The request expired.",
};

type Command = Extract<
  SessionPermissionSignal,
  { type: "permission-request" | "permission-cancel" }
>;

export function permissionRequests(
  send: (command: Command) => void,
  update: (view: PermissionRequestView) => void,
) {
  let options: SessionPermission[] = [];
  let status = "";
  let generation = 0;
  let pending:
    | {
        attempt: string;
        scope: SessionPermission;
        id?: string;
        cancelling?: boolean;
      }
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = () =>
    update({
      options,
      status,
      busy: pending !== undefined,
      canCancel: pending?.id !== undefined && !pending.cancelling,
    });
  const settle = (message: string) => {
    clearTimeout(timer);
    pending = undefined;
    status = message;
    render();
  };
  return {
    reset(nextGeneration = generation) {
      generation = nextGeneration;
      options = [];
      settle("");
    },
    request(scope: SessionPermission) {
      if (pending || !options.includes(scope)) return;
      const attempt = crypto.randomUUID();
      pending = { attempt, scope };
      status = `Asking for ${permissionNames[scope].toLowerCase()}…`;
      timer = setTimeout(
        () => settle("The device did not answer the request."),
        8000,
      );
      render();
      send({ type: "permission-request", generation, attempt, scope });
    },
    cancel() {
      if (!pending?.id || pending.cancelling) return;
      pending.cancelling = true;
      status = "Cancelling request…";
      render();
      send({ type: "permission-cancel", generation, id: pending.id });
    },
    hasPendingControl(id: string) {
      return pending?.scope === "control" && pending.id === id;
    },
    receive(raw: unknown) {
      const parsed = viewerPermissionSignal.safeParse(raw);
      if (!parsed.success || parsed.data.generation !== generation) return;
      const message = parsed.data;
      if (message.type === "permission-options") {
        options = [...new Set(message.scopes)];
        render();
        return;
      }
      if (!pending) return;
      if (message.type === "permission-result") {
        if (message.id !== pending.id) return;
        const result = {
          id: message.id,
          scope: pending.scope,
          outcome: message.outcome,
        };
        settle(outcomes[message.outcome]);
        return result;
      }
      if (
        pending.id ||
        message.attempt !== pending.attempt ||
        message.scope !== pending.scope
      )
        return;
      if (message.type === "permission-unavailable") {
        settle("That request is unavailable. Try again shortly.");
        return;
      }
      pending.id = message.id;
      status = "Waiting for approval on the device…";
      clearTimeout(timer);
      timer = setTimeout(
        () => settle(outcomes.expired),
        message.timeoutMs + 1000,
      );
      render();
    },
  };
}
