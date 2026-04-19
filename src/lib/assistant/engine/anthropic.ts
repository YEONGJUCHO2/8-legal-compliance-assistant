import { generateAnswer } from "@/lib/assistant/engine/generate";

import { bindHandle, createDbEngineSessionStore, type EngineSessionStore } from "./session-store";
import type { EngineAdapter, EnginePrompt } from "./types";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24;

export class EngineTransportError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`anthropic_transport_error:${status}`);
    this.name = "EngineTransportError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export interface CreateAnthropicAdapterOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  sessionStore?: EngineSessionStore;
  now?: () => Date;
  sessionTtlMs?: number;
  deadlineMs?: number;
}

function buildMessagesRequest({
  model,
  prompt,
  sessionHandle,
  schemaRef
}: {
  model: string;
  prompt: EnginePrompt;
  sessionHandle: string;
  schemaRef: string;
}) {
  return {
    model,
    max_tokens: 1200,
    system: prompt.system,
    messages: [
      {
        role: "user",
        content: prompt.user
      }
    ],
    metadata: {
      session_handle: sessionHandle,
      reference_date: prompt.referenceDate,
      schema_ref: schemaRef
    }
  };
}

function extractTextContent(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("content" in payload) || !Array.isArray(payload.content)) {
    return "";
  }

  return payload.content
    .filter(
      (block): block is {
        type?: string;
        text?: string;
      } => Boolean(block && typeof block === "object")
    )
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("\n")
    .trim();
}

export function createAnthropicAdapter(options: CreateAnthropicAdapterOptions): EngineAdapter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let sessionStore = options.sessionStore;
  const getSessionStore = () => {
    if (!sessionStore) {
      sessionStore = createDbEngineSessionStore();
    }

    return sessionStore;
  };

  return {
    provider: "anthropic",
    async generate(input) {
      const now = options.now?.() ?? new Date();
      const expiresAt = new Date(now.getTime() + (options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS)).toISOString();
      const session = await bindHandle(
        {
          userId: input.userId,
          provider: "anthropic",
          sessionId: input.sessionId,
          expiresAt,
          now
        },
        getSessionStore()
      );
      const { response, schemaRetries } = await generateAnswer({
        prompt: input.prompt,
        schemaRef: input.schemaRef,
        request: async (prompt) => {
          const upstreamResponse = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": options.apiKey,
              "anthropic-version": "2023-06-01"
            },
            signal:
              (input.deadlineMs ?? options.deadlineMs) && typeof AbortSignal.timeout === "function"
                ? AbortSignal.timeout(input.deadlineMs ?? options.deadlineMs ?? 0)
                : undefined,
            body: JSON.stringify(
              buildMessagesRequest({
                model: options.model ?? DEFAULT_MODEL,
                prompt,
                sessionHandle: session.handle,
                schemaRef: input.schemaRef
              })
            )
          });

          if (!upstreamResponse.ok) {
            throw new EngineTransportError(upstreamResponse.status, await upstreamResponse.text());
          }

          return extractTextContent((await upstreamResponse.json()) as unknown);
        }
      });

      return {
        sessionId: session.id,
        response,
        schemaRetries
      };
    }
  };
}

export { buildMessagesRequest };
