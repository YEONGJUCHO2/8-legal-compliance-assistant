import { engineOutputJsonSchemas, engineOutputSchemas } from "@/lib/assistant/schemas";

import { bindHandle, createDbEngineSessionStore, type EngineSessionStore } from "./session-store";
import type { EngineAdapter, EnginePrompt, EngineSchemaRef } from "./types";

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24;

type CodexDaemonSuccess = {
  sessionId: string;
  response: unknown;
  schemaRetries: number;
};

type CodexDaemonFailure = {
  error: {
    code: string;
    message: string;
  };
};

export class CodexDaemonConfigError extends Error {
  constructor(message = "engine_config_missing") {
    super(message);
    this.name = "CodexDaemonConfigError";
  }
}

export class CodexDaemonError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message = code, status?: number) {
    super(message);
    this.name = "CodexDaemonError";
    this.code = code;
    this.status = status;
  }
}

export interface CreateCodexAdapterOptions {
  daemonUrl?: string;
  deadlineMs?: number;
  fetchImpl?: typeof fetch;
  model?: string;
  sessionStore?: EngineSessionStore;
  now?: () => Date;
  sessionTtlMs?: number;
}

function buildPromptText(prompt: EnginePrompt) {
  return ["SYSTEM", prompt.system, "", "USER", prompt.user].join("\n");
}

function resolveGenerateUrl(daemonUrl: string) {
  const baseUrl = daemonUrl.endsWith("/") ? daemonUrl : `${daemonUrl}/`;

  return new URL("generate", baseUrl).toString();
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

async function parseDaemonPayload(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CodexDaemonError("engine_failure", "invalid_daemon_response", response.status);
  }
}

function toSchemaError(message: string) {
  return {
    type: "schema_error" as const,
    message,
    schema_retry_count: 2 as const
  };
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripNulls(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== null);

  return Object.fromEntries(entries.map(([key, entryValue]) => [key, stripNulls(entryValue)]));
}

export function createCodexAdapter(options: CreateCodexAdapterOptions = {}): EngineAdapter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let sessionStore = options.sessionStore;
  const getSessionStore = () => {
    if (!sessionStore) {
      sessionStore = createDbEngineSessionStore();
    }

    return sessionStore;
  };

  return {
    provider: "codex",
    async generate(input) {
      if (!options.daemonUrl) {
        throw new CodexDaemonConfigError();
      }

      const now = options.now?.() ?? new Date();
      const expiresAt = new Date(now.getTime() + (options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS)).toISOString();
      const session = await bindHandle(
        {
          userId: input.userId,
          provider: "codex",
          sessionId: input.sessionId,
          expiresAt,
          now
        },
        getSessionStore()
      );

      const requestBody = {
        prompt: buildPromptText(input.prompt),
        schemaRef: input.schemaRef,
        schema: engineOutputJsonSchemas[input.schemaRef],
        sessionId: session.handle,
        timeoutMs: input.deadlineMs ?? options.deadlineMs,
        model: options.model
      };
      const signal =
        (input.deadlineMs ?? options.deadlineMs) && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(input.deadlineMs ?? options.deadlineMs ?? 0)
          : undefined;
      let payload: unknown;

      try {
        const response = await fetchImpl(resolveGenerateUrl(options.daemonUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(requestBody),
          signal
        });

        payload = await parseDaemonPayload(response);

        if (payload && typeof payload === "object" && "error" in payload) {
          const failure = payload as CodexDaemonFailure;

          if (failure.error.code === "schema_error") {
            return {
              sessionId: session.id,
              response: toSchemaError(failure.error.message),
              schemaRetries: 2
            };
          }

          throw new CodexDaemonError(failure.error.code, failure.error.message, response.status);
        }

        if (!response.ok) {
          throw new CodexDaemonError("engine_failure", `codex_daemon_http_${response.status}`, response.status);
        }
      } catch (error) {
        if (error instanceof CodexDaemonError) {
          throw error;
        }

        if (isAbortError(error)) {
          throw new CodexDaemonError("engine_timeout");
        }

        throw new CodexDaemonError(
          "engine_failure",
          error instanceof Error ? error.message : "engine_failure"
        );
      }

      if (!payload || typeof payload !== "object") {
        throw new CodexDaemonError("engine_failure", "invalid_daemon_response");
      }

      const success = payload as CodexDaemonSuccess;
      const schemaRetries = success.schemaRetries;

      if (schemaRetries !== 0 && schemaRetries !== 1) {
        throw new CodexDaemonError("engine_failure", "invalid_schema_retry_count");
      }

      const response = engineOutputSchemas[input.schemaRef as EngineSchemaRef].parse(stripNulls(success.response));

      return {
        sessionId: session.id,
        response,
        schemaRetries
      };
    }
  };
}
