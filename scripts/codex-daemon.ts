import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";

import pino from "pino";

type SchemaRef = "answer" | "clarify" | "no_match" | "verification_pending" | "schema_error";

type JsonSchema = {
  additionalProperties?: boolean;
  const?: unknown;
  enum?: unknown[];
  items?: JsonSchema;
  minLength?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: "array" | "null" | "object" | "string" | Array<"array" | "null" | "object" | "string">;
};

type GenerateRequest = {
  model?: string;
  prompt: string;
  schema: JsonSchema;
  schemaRef: SchemaRef;
  sessionId?: string;
  timeoutMs?: number;
};

type GenerateSuccess = {
  response: unknown;
  schemaRetries: 0 | 1;
  sessionId: string;
};

type ErrorCode = "engine_busy" | "engine_failure" | "engine_timeout" | "schema_error";

class RequestFailure extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "RequestFailure";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const logger = pino({
  name: "codex-daemon"
});
const DAEMON_TEMP_PREFIX = "legal-compliance-codex-daemon-";
const DEFAULT_TIMEOUT_MS = 55_000;
const MAX_QUEUE_DEPTH = 10;
const SESSION_CACHE_DIR = path.join(
  process.env.HOME ?? process.cwd(),
  ".cache",
  "legal-compliance-codex-daemon"
);
const SESSION_CACHE_FILE = path.join(SESSION_CACHE_DIR, "sessions.json");
const HOST = process.env.CODEX_DAEMON_HOST ?? "127.0.0.1";
const PORT = Number(process.env.CODEX_DAEMON_PORT ?? "4200");
const USE_PTY_WRAPPER = process.platform === "darwin" && process.env.CODEX_DAEMON_DISABLE_PTY !== "1";

let draining = false;
let queueDepth = 0;
let queueChain: Promise<void> = Promise.resolve();
let codexVersionPromise: Promise<string> | undefined;
const sessionRollouts = new Map<string, string>();

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesSchemaType(
  schemaType: JsonSchema["type"],
  value: unknown
): schemaType is NonNullable<JsonSchema["type"]> {
  if (!schemaType) {
    return true;
  }

  const accepted = Array.isArray(schemaType) ? schemaType : [schemaType];

  return accepted.some((type) => {
    if (type === "null") {
      return value === null;
    }

    if (type === "string") {
      return typeof value === "string";
    }

    if (type === "array") {
      return Array.isArray(value);
    }

    if (type === "object") {
      return isPlainObject(value);
    }

    return false;
  });
}

function validateJsonSchema(schema: JsonSchema, value: unknown): boolean {
  if (schema.const !== undefined) {
    return value === schema.const;
  }

  if (schema.enum) {
    return schema.enum.includes(value);
  }

  if (!matchesSchemaType(schema.type, value)) {
    return false;
  }

  if (value === null) {
    return true;
  }

  if (typeof value === "string") {
    return typeof value === "string" && (schema.minLength === undefined || value.length >= schema.minLength);
  }

  if (Array.isArray(value)) {
    return Array.isArray(value) && (!schema.items || value.every((entry) => validateJsonSchema(schema.items!, entry)));
  }

  if (isPlainObject(value)) {
    if (!isPlainObject(value)) {
      return false;
    }

    const required = schema.required ?? [];
    for (const key of required) {
      if (!(key in value)) {
        return false;
      }
    }

    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) {
          return false;
        }
      }
    }

    if (!schema.properties) {
      return true;
    }

    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value && !validateJsonSchema(childSchema, value[key])) {
        return false;
      }
    }

    return true;
  }

  return true;
}

function parseGenerateRequest(value: unknown): GenerateRequest {
  if (!isPlainObject(value)) {
    throw new RequestFailure("engine_failure", "request_body_must_be_object", 400);
  }

  if (typeof value.prompt !== "string" || value.prompt.length === 0) {
    throw new RequestFailure("engine_failure", "prompt_must_be_non_empty_string", 400);
  }

  if (
    value.schemaRef !== "answer" &&
    value.schemaRef !== "clarify" &&
    value.schemaRef !== "no_match" &&
    value.schemaRef !== "verification_pending" &&
    value.schemaRef !== "schema_error"
  ) {
    throw new RequestFailure("engine_failure", "schemaRef_invalid", 400);
  }

  if (!isPlainObject(value.schema)) {
    throw new RequestFailure("engine_failure", "schema_must_be_object", 400);
  }

  if (value.sessionId !== undefined && typeof value.sessionId !== "string") {
    throw new RequestFailure("engine_failure", "sessionId_must_be_string", 400);
  }

  const timeoutMs = value.timeoutMs;

  if (
    timeoutMs !== undefined &&
    timeoutMs !== null &&
    (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
  ) {
    throw new RequestFailure("engine_failure", "timeoutMs_must_be_positive_number", 400);
  }

  if (value.model !== undefined && typeof value.model !== "string") {
    throw new RequestFailure("engine_failure", "model_must_be_string", 400);
  }

  return {
    prompt: value.prompt,
    schemaRef: value.schemaRef,
    schema: value.schema as JsonSchema,
    sessionId: value.sessionId,
    timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
    model: value.model
  };
}

function extractSessionCandidate(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = extractSessionCandidate(entry);

      if (candidate) {
        return candidate;
      }
    }

    return undefined;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  for (const key of ["rollout_id", "session_id", "rolloutId", "sessionId"]) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  for (const nested of Object.values(value)) {
    const candidate = extractSessionCandidate(nested);

    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function createJsonLineCollector(onObject: (value: unknown) => void) {
  let buffer = "";

  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        const jsonStart = trimmed.indexOf("{");
        const normalized = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;

        if (normalized.length === 0) {
          continue;
        }

        try {
          onObject(JSON.parse(normalized) as unknown);
        } catch {}
      }
    },
    flush() {
      const trimmed = buffer.trim();
      const jsonStart = trimmed.indexOf("{");
      const normalized = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;

      if (normalized.length === 0) {
        return;
      }

      try {
        onObject(JSON.parse(normalized) as unknown);
      } catch {}
    }
  };
}

async function readCodexVersion() {
  const child = spawn("codex", ["--version"], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `codex_version_exit_${exitCode}`);
  }

  return stdout.trim();
}

function getCodexVersion() {
  if (!codexVersionPromise) {
    codexVersionPromise = readCodexVersion().catch((error) => {
      logger.warn({ error }, "failed_to_read_codex_version");
      return "unknown";
    });
  }

  return codexVersionPromise;
}

async function loadSessionCache() {
  try {
    const raw = await readFile(SESSION_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;

    for (const [sessionId, rolloutId] of Object.entries(parsed)) {
      if (typeof rolloutId === "string" && rolloutId.length > 0) {
        sessionRollouts.set(sessionId, rolloutId);
      }
    }
  } catch {}
}

async function persistSessionCache() {
  await mkdir(SESSION_CACHE_DIR, { recursive: true });
  await writeFile(SESSION_CACHE_FILE, JSON.stringify(Object.fromEntries(sessionRollouts), null, 2), "utf8");
}

async function runCodexAttempt(input: {
  model?: string;
  prompt: string;
  resumeRolloutId?: string;
  schema: JsonSchema;
  timeoutMs: number;
}) {
  const tempDir = await mkdtemp(path.join(tmpdir(), DAEMON_TEMP_PREFIX));
  const schemaFile = path.join(tempDir, "schema.json");
  const outputFile = path.join(tempDir, "last-message.txt");
  const codexArgs = input.resumeRolloutId
    ? ["exec", "resume", "--json", "--skip-git-repo-check", "--output-last-message", outputFile]
    : ["exec", "--json", "--skip-git-repo-check", "--output-schema", schemaFile, "--output-last-message", outputFile];

  if (input.model) {
    codexArgs.push("-m", input.model);
  }

  if (input.resumeRolloutId) {
    codexArgs.push(input.resumeRolloutId);
  }

  codexArgs.push(input.prompt);
  await writeFile(schemaFile, JSON.stringify(input.schema, null, 2), "utf8");

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let rolloutId: string | undefined;
  const collector = createJsonLineCollector((value) => {
    const candidate = extractSessionCandidate(value);

    if (candidate) {
      rolloutId = candidate;
    }
  });

  try {
    const command = USE_PTY_WRAPPER ? "script" : "codex";
    const args = USE_PTY_WRAPPER ? ["-q", "/dev/null", "codex", ...codexArgs] : codexArgs;
    const child = spawn(command, args, {
      stdio: [USE_PTY_WRAPPER ? "ignore" : "pipe", "pipe", "pipe"]
    });
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    const stdinStream = child.stdin;

    if (!stdoutStream || !stderrStream || (!USE_PTY_WRAPPER && !stdinStream)) {
      throw new RequestFailure("engine_failure", "codex_stdio_not_available", 502);
    }

    stdoutStream.setEncoding("utf8");
    stderrStream.setEncoding("utf8");
    stdoutStream.on("data", (chunk) => {
      stdout += chunk;
      collector.push(chunk);
    });
    stderrStream.on("data", (chunk) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
      }, 2_000).unref();
    }, input.timeoutMs);

    if (!USE_PTY_WRAPPER && stdinStream) {
      stdinStream.end();
    }

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });

    clearTimeout(timeout);
    collector.flush();

    if (timedOut) {
      throw new RequestFailure("engine_timeout", "codex_execution_timed_out", 504);
    }

    if (exitCode !== 0) {
      throw new RequestFailure("engine_failure", stderr.trim() || `codex_exit_${exitCode}`, 502);
    }

    const rawOutput = await readFile(outputFile, "utf8");
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawOutput) as unknown;
    } catch {
      throw new RequestFailure("schema_error", "codex_output_was_not_valid_json", 422);
    }

    if (!validateJsonSchema(input.schema, parsed)) {
      throw new RequestFailure("schema_error", "codex_output_failed_schema_validation", 422);
    }

    logger.info(
      {
        args,
        exitCode,
        command,
        rolloutId,
        stderrLength: stderr.length,
        stdoutLength: stdout.length
      },
      "codex_attempt_completed"
    );

    return {
      parsed,
      rolloutId
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function generateStructuredResponse(request: GenerateRequest): Promise<GenerateSuccess> {
  const sessionId = request.sessionId ?? randomUUID();
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const priorRollout = sessionRollouts.get(sessionId);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await runCodexAttempt({
        prompt: request.prompt,
        schema: request.schema,
        timeoutMs,
        model: request.model,
        resumeRolloutId: attempt === 0 ? priorRollout : undefined
      });

      if (result.rolloutId) {
        sessionRollouts.set(sessionId, result.rolloutId);
        await persistSessionCache();
      }

      return {
        sessionId,
        response: result.parsed,
        schemaRetries: attempt as 0 | 1
      };
    } catch (error) {
      if (error instanceof RequestFailure && error.code === "schema_error") {
        logger.warn({ attempt, sessionId, error: error.message }, "schema_retry_needed");

        if (attempt === 0) {
          continue;
        }
      }

      throw error;
    }
  }

  throw new RequestFailure(
    "schema_error",
    "Engine response did not satisfy the required schema after one retry.",
    422
  );
}

function enqueue<T>(task: () => Promise<T>) {
  if (queueDepth >= MAX_QUEUE_DEPTH) {
    throw new RequestFailure("engine_busy", "codex daemon queue is full", 503);
  }

  queueDepth += 1;
  const work = queueChain.then(task);

  queueChain = work.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    queueDepth -= 1;
  });

  return work;
}

async function handleGenerate(request: IncomingMessage, response: ServerResponse) {
  if (draining) {
    writeJson(response, 503, {
      error: {
        code: "engine_busy",
        message: "daemon_is_draining"
      }
    });
    return;
  }

  const rawBody = await readRequestBody(request);
  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody) as unknown;
  } catch {
    throw new RequestFailure("engine_failure", "request_body_must_be_valid_json", 400);
  }

  const generateRequest = parseGenerateRequest(parsedBody);
  logger.info(
    {
      schemaRef: generateRequest.schemaRef,
      sessionId: generateRequest.sessionId,
      timeoutMs: generateRequest.timeoutMs ?? DEFAULT_TIMEOUT_MS
    },
    "generate_request_started"
  );

  const startedAt = Date.now();
  const result = await enqueue(() => generateStructuredResponse(generateRequest));

  logger.info(
    {
      durationMs: Date.now() - startedAt,
      schemaRetries: result.schemaRetries,
      sessionId: result.sessionId
    },
    "generate_request_completed"
  );

  writeJson(response, 200, result);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  try {
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, {
        ok: true,
        codex_version: await getCodexVersion()
      });
      return;
    }

    if (request.method === "POST" && request.url === "/generate") {
      await handleGenerate(request, response);
      return;
    }

    writeJson(response, 404, {
      error: {
        code: "engine_failure",
        message: "not_found"
      }
    });
  } catch (error) {
    if (error instanceof RequestFailure) {
      logger.error({ code: error.code, error: error.message }, "request_failed");
      writeJson(response, error.statusCode, {
        error: {
          code: error.code,
          message: error.message
        }
      });
      return;
    }

    logger.error({ error }, "unexpected_request_failure");
    writeJson(response, 500, {
      error: {
        code: "engine_failure",
        message: error instanceof Error ? error.message : "engine_failure"
      }
    });
  }
}

export async function startCodexDaemon() {
  await loadSessionCache();
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(PORT, HOST, () => resolve());
  });

  logger.info({ host: HOST, port: PORT }, "codex_daemon_listening");

  const shutdown = () => {
    if (draining) {
      return;
    }

    draining = true;
    server.close(() => {
      void queueChain.finally(() => {
        logger.info("codex_daemon_stopped");
        process.exit(0);
      });
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return server;
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  void startCodexDaemon().catch((error) => {
    logger.error({ error }, "codex_daemon_boot_failed");
    process.exitCode = 1;
  });
}
