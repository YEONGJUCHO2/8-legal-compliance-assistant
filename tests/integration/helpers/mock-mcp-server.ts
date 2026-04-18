import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type StubResponse =
  | {
      status: number;
      body?: unknown;
      headers?: Record<string, string>;
      delayMs?: number;
    }
  | ((input: { url: URL; req: IncomingMessage }) => Promise<{
      status: number;
      body?: unknown;
      headers?: Record<string, string>;
      delayMs?: number;
    }> | {
      status: number;
      body?: unknown;
      headers?: Record<string, string>;
      delayMs?: number;
    });

type Stub = {
  method: string;
  path: string;
  match?: (url: URL, req: IncomingMessage) => boolean;
  respond: StubResponse;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBody(body: unknown) {
  if (body === undefined) {
    return "";
  }

  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body);
}

function writeResponse(res: ServerResponse, response: { status: number; body?: unknown; headers?: Record<string, string> }) {
  const payload = normalizeBody(response.body);
  const headers = {
    ...(typeof response.body === "string" || response.body === undefined
      ? {}
      : {
          "content-type": "application/json"
        }),
    ...(response.headers ?? {})
  };

  res.writeHead(response.status, headers);
  res.end(payload);
}

export async function startMockMcp({ port = 0 }: { port?: number } = {}) {
  const stubs: Stub[] = [];
  const requests: Array<{ method: string; url: string }> = [];

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    requests.push({
      method,
      url: url.toString()
    });

    const stub = stubs.find(
      (candidate) =>
        candidate.method.toUpperCase() === method.toUpperCase() &&
        candidate.path === url.pathname &&
        (candidate.match ? candidate.match(url, req) : true)
    );

    if (!stub) {
      writeResponse(res, {
        status: 404,
        body: {
          message: `no_stub:${method}:${url.pathname}`
        }
      });
      return;
    }

    const response = typeof stub.respond === "function" ? await stub.respond({ url, req }) : stub.respond;

    if (response.delayMs) {
      await sleep(response.delayMs);
    }

    writeResponse(res, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("mock_mcp_server_address_unavailable");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    stub(definition: Stub) {
      stubs.push(definition);
    },
    reset() {
      stubs.length = 0;
      requests.length = 0;
    },
    async close() {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}
