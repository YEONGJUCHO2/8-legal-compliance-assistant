import { z } from "zod";

const providerSchema = z.enum(["anthropic", "codex"]);

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    LAW_API_KEY: z.string().min(1),
    KOREAN_LAW_MCP_URL: z.string().url(),
    ENGINE_PROVIDER: providerSchema,
    ANTHROPIC_API_KEY: z.string().min(1),
    CODEX_DAEMON_URL: z.string().url(),
    APP_BASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(1),
    AUTH_MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    AUTH_FROM_EMAIL: z.string().email().optional(),
    METRICS_ACCESS_TOKEN: z.string().min(1).optional(),
    SMTP_URL: z.string().min(1).optional(),
    RETRIEVAL_DEADLINE_MS: z.coerce.number().int().positive(),
    ENGINE_DEADLINE_MS: z.coerce.number().int().positive(),
    MCP_VERIFY_DEADLINE_MS: z.coerce.number().int().positive(),
    ROUTE_MAX_DURATION_SECONDS: z.coerce.number().int().positive(),
    DEADLINE_SAFETY_MARGIN_MS: z.coerce.number().int().nonnegative(),
  })
  .superRefine((env, ctx) => {
    const totalDeadlineMs =
      env.RETRIEVAL_DEADLINE_MS +
      env.ENGINE_DEADLINE_MS +
      env.MCP_VERIFY_DEADLINE_MS +
      env.DEADLINE_SAFETY_MARGIN_MS;
    const routeBudgetMs = env.ROUTE_MAX_DURATION_SECONDS * 1000;

    if (totalDeadlineMs > routeBudgetMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Deadline budget exceeds route maxDuration. Reconcile retrieval, engine, verification, and safety margins.",
        path: ["ROUTE_MAX_DURATION_SECONDS"],
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function parseEnv(rawEnv: Record<string, string | undefined>): AppEnv {
  return envSchema.parse(rawEnv);
}

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }

  return cachedEnv;
}
