import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  WEB_ORIGIN: z.string().url(),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3010),
  TRUST_PROXY_CIDR: z.string().min(1).optional(),
  SESSION_SECRET: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  STUN_URL: z
    .string()
    .regex(/^stun:[A-Za-z0-9.-]+:[0-9]+$/)
    .optional(),
  TURN_URLS: z
    .string()
    .transform((value) => value.split(",").map((url) => url.trim()))
    .pipe(
      z
        .array(
          z
            .string()
            .max(256)
            .refine((value) => {
              const match =
                /^(turn|turns):([A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\]):([0-9]{1,5})\?transport=(udp|tcp)$/.exec(
                  value,
                );
              return Boolean(
                match &&
                Number(match[3]) > 0 &&
                Number(match[3]) <= 65535 &&
                match[1] === "turn" &&
                match[4] === "udp",
              );
            }, "Use an explicit TURN host and port with UDP; native TCP/TLS TURN is unsupported"),
        )
        .min(1)
        .max(3),
    )
    .optional(),
  TURN_SECRET: z.string().min(32).max(256).optional(),
  ICE_TRANSPORT_POLICY: z.enum(["all", "relay"]).optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});
export type Config = z.infer<typeof schema>;
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const config = schema.parse(env);
  if (Boolean(config.TURN_URLS) !== Boolean(config.TURN_SECRET)) {
    throw new Error("TURN_URLS and TURN_SECRET must be configured together");
  }
  if (config.TURN_URLS && !config.SESSION_SECRET) {
    throw new Error("TURN requires enabled view sessions");
  }
  if (config.ICE_TRANSPORT_POLICY === "relay" && !config.TURN_URLS) {
    throw new Error("Relay-only policy requires TURN configuration");
  }
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
