import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

import type { AppLogger } from "@/lib/logging";

type BadRequestMessage = "invalid_request" | "invalid_json" | "invalid_email";

export function createBadRequestResponse(message: BadRequestMessage) {
  return NextResponse.json(
    {
      kind: "error",
      message
    },
    {
      status: 400
    }
  );
}

export async function parseJsonBody<T>({
  request,
  schema,
  logger,
  zodMessage = "invalid_request"
}: {
  request: Request;
  schema: ZodType<T>;
  logger: AppLogger;
  zodMessage?: Exclude<BadRequestMessage, "invalid_json">;
}): Promise<
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      response: Response;
    }
> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return {
      ok: false,
      response: createBadRequestResponse("invalid_json")
    };
  }

  try {
    return {
      ok: true,
      data: schema.parse(payload)
    };
  } catch (error) {
    if (error instanceof ZodError) {
      logger.warn(
        {
          eventType: "request_bad_input",
          issues: error.issues
        },
        "request_bad_input"
      );

      return {
        ok: false,
        response: createBadRequestResponse(zodMessage)
      };
    }

    throw error;
  }
}
