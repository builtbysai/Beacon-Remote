import { cp } from "node:fs/promises";
await cp(
  new URL("../migrations", import.meta.url),
  new URL("../dist/apps/backend/migrations", import.meta.url),
  { recursive: true },
);
