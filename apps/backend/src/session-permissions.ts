import { randomUUID } from "node:crypto";
import type {
  SessionPermission,
  SessionPermissionSignal,
  ViewerPermissionSignal,
} from "../../../packages/protocol/src/session-permissions.js";

const REQUEST_MS = 30_000;
const REQUEST_GAP_MS = 5_000;
type Request = { id: string; scope: SessionPermission; expires: number };

type Outbound =
  | ViewerPermissionSignal
  | {
      type: "permission-prompt";
      generation: number;
      id: string;
      scope: SessionPermission;
      timeoutMs: number;
    }
  | {
      type: "permission-dismiss" | "permission-commit";
      generation: number;
      id: string;
    };

type Role = "machine" | "viewer";

/** A prompt only. The session grant and endpoint capability checks remain independent. */
export class SessionPermissionRequests {
  private options = new Set<SessionPermission>();
  private pending: Request | undefined;
  private nextRequest = 0;
  private generation = 0;
  private viewerReady = false;

  constructor(
    private readonly send: (role: Role, message: Outbound) => void,
    private readonly now = () => performance.now(),
  ) {}

  receive(
    role: Role,
    message: SessionPermissionSignal,
    controlAllowed: boolean,
  ) {
    if (message.generation !== this.generation) return;
    this.expire();
    const generation = this.generation;
    switch (message.type) {
      case "permission-hello":
        if (role !== "viewer") return;
        this.viewerReady = true;
        this.send("viewer", {
          type: "permission-options",
          generation,
          scopes: [...this.options],
        });
        return;
      case "permission-options":
        if (role !== "machine") return;
        this.options = new Set(
          message.scopes.filter(
            (scope) => scope !== "control" || controlAllowed,
          ),
        );
        if (this.pending && !this.options.has(this.pending.scope))
          this.settle("cancelled");
        if (this.viewerReady)
          this.send("viewer", {
            type: "permission-options",
            generation,
            scopes: [...this.options],
          });
        return;
      case "permission-request": {
        if (role !== "viewer" || !this.viewerReady) return;
        const now = this.now();
        const { scope, attempt } = message;
        if (
          this.pending ||
          now < this.nextRequest ||
          !this.options.has(scope) ||
          (scope === "control" && !controlAllowed)
        ) {
          this.send("viewer", {
            type: "permission-unavailable",
            generation,
            scope,
            attempt,
          });
          return;
        }
        const id = randomUUID();
        this.pending = { id, scope, expires: now + REQUEST_MS };
        this.nextRequest = now + REQUEST_GAP_MS;
        const details = { generation, id, scope, timeoutMs: REQUEST_MS };
        this.send("viewer", {
          type: "permission-pending",
          attempt,
          ...details,
        });
        this.send("machine", { type: "permission-prompt", ...details });
        return;
      }
      case "permission-cancel":
        if (role === "viewer" && message.id === this.pending?.id)
          this.settle("cancelled");
        return;
      case "permission-decision":
        if (
          role === "machine" &&
          this.pending &&
          message.id === this.pending.id
        ) {
          const allowed = this.pending.scope !== "control" || controlAllowed;
          this.settle(message.approved && allowed ? "approved" : "denied");
        }
    }
  }

  expire() {
    if (this.pending && this.now() >= this.pending.expires)
      this.settle("expired");
  }

  detach() {
    this.options.clear();
    this.settle("cancelled");
    this.viewerReady = false;
  }

  resume(generation: number) {
    this.detach();
    this.generation = generation;
  }

  private settle(
    outcome: Extract<Outbound, { type: "permission-result" }>["outcome"],
  ) {
    if (!this.pending) return;
    const { id } = this.pending;
    this.pending = undefined;
    const generation = this.generation;
    this.send("machine", {
      type: outcome === "approved" ? "permission-commit" : "permission-dismiss",
      generation,
      id,
    });
    this.send("viewer", { type: "permission-result", generation, id, outcome });
  }
}
