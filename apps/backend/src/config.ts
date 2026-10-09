import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  WEB_ORIGIN: z.string().url(),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3010),
  TRUST_PROXY_CIDR: z.string().min(1).optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});
export type Config = z.infer<typeof schema>;
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const config = schema.parse(env);
  const origin = new URL(config.WEB_ORIGIN);
  if (
    origin.origin !== config.WEB_ORIGIN ||
    (config.NODE_ENV === "production" && origin.protocol !== "https:")
  ) {
    throw new Error(
      "WEB_ORIGIN must be a bare origin; production requires HTTPS",
    );
  }
  return config;
}
