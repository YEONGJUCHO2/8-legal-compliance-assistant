import pino, { type Logger as PinoLogger } from "pino";

import { getAssistantDeps } from "@/lib/assistant/deps";
import type { ObservabilityLogEvent } from "@/lib/db/rows";

type LogRecord = Record<string, unknown>;

export interface AppLogger {
  info(obj: LogRecord, message?: string): void;
  warn(obj: LogRecord, message?: string): void;
  error(obj: LogRecord, message?: string): void;
  debug(obj: LogRecord, message?: string): void;
  child(bindings: LogRecord): AppLogger;
  drain(): LogRecord[];
}

function createMemoryDestination(records: LogRecord[]) {
  return {
    write(chunk: string) {
      const trimmed = chunk.trim();
      if (!trimmed) {
        return true;
      }

      records.push(JSON.parse(trimmed) as LogRecord);
      return true;
    }
  };
}

function wrapLogger(logger: PinoLogger, records: LogRecord[]): AppLogger {
  return {
    info(obj, message) {
      logger.info(obj, message);
    },
    warn(obj, message) {
      logger.warn(obj, message);
    },
    error(obj, message) {
      logger.error(obj, message);
    },
    debug(obj, message) {
      logger.debug(obj, message);
    },
    child(bindings) {
      return wrapLogger(logger.child(bindings), records);
    },
    drain() {
      return records.splice(0, records.length);
    }
  };
}

export function createLogger({
  service = "legal-compliance-assistant"
}: {
  service?: string;
} = {}): AppLogger {
  const records: LogRecord[] = [];
  const logger = pino(
    {
      base: {
        service
      },
      redact: {
        paths: ["req.headers.authorization", "*.password", "*.token", "*.apiKey", "password", "token", "apiKey"],
        censor: "[Redacted]"
      }
    },
    createMemoryDestination(records)
  );

  return wrapLogger(logger, records);
}

export function withRequestContext(
  logger: AppLogger,
  {
    requestId,
    userId,
    runId
  }: {
    requestId: string;
    userId?: string;
    runId?: string;
  }
) {
  return logger.child({
    requestId,
    userId,
    runId
  });
}

export function logAssistantRunEvent(logger: AppLogger, event: ObservabilityLogEvent) {
  logger.info(
    {
      eventType: "assistant_run",
      ...event
    },
    "assistant_run"
  );
}

export function withRequestLogging<TContext = undefined>(
  handler: (
    request: Request,
    logged: {
      requestId: string;
      logger: AppLogger;
    },
    context: TContext
  ) => Promise<Response>
) {
  return async (request: Request, context?: TContext) => {
    const deps = getAssistantDeps();
    const requestId = deps.generateRequestId?.() ?? `reqid_fallback`;
    const logger = withRequestContext(deps.logger ?? createLogger(), {
      requestId
    });
    const url = new URL(request.url);

    logger.info(
      {
        eventType: "request_start",
        method: request.method,
        path: url.pathname
      },
      "request_start"
    );

    try {
      const response = await handler(request, { requestId, logger }, context as TContext);
      response.headers.set("x-request-id", requestId);

      logger.info(
        {
          eventType: "request_complete",
          method: request.method,
          path: url.pathname,
          status: response.status
        },
        "request_complete"
      );

      return response;
    } catch (error) {
      logger.error(
        {
          eventType: "request_error",
          method: request.method,
          path: url.pathname,
          error: error instanceof Error ? error.message : "unknown_error"
        },
        "request_error"
      );
      throw error;
    }
  };
}
