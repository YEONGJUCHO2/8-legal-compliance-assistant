// @vitest-environment node

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { afterEach, describe, expect, test } from "vitest";

const LAW_MCP_TEMP_PREFIX = "legal-compliance-law-mcp-";

type StartedServer = {
  baseUrl: string;
  process: ChildProcess;
  tempRoot: string;
  upstreamLogPath: string;
};

const startedServers: StartedServer[] = [];

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("free_port_unavailable"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);

      if (response.ok) {
        return;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("law_mcp_health_timeout");
}

async function countLawMcpTempDirs() {
  const entries = await readdir(tmpdir(), { withFileTypes: true });

  return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(LAW_MCP_TEMP_PREFIX)).length;
}

async function startLawMcpServer() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "law-mcp-test-"));
  const upstreamLogPath = path.join(tempRoot, "upstream.log");
  const overridePath = path.join(tempRoot, "override.json");
  const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "open-law");
  const port = await getFreePort();

  await writeFile(
    overridePath,
    JSON.stringify(
      {
        rules: [
          {
            path: "/DRF/lawSearch.do",
            params: {
              query: "산업안전보건법",
              target: "law",
              type: "XML"
            },
            status: 200,
            bodyFile: path.join(fixturesDir, "san-an-search.xml")
          },
          {
            path: "/DRF/lawSearch.do",
            params: {
              query: "없는법",
              target: "law",
              type: "XML"
            },
            status: 200,
            body:
              '<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>law</target><키워드>없는법</키워드><totalCnt>0</totalCnt><page>1</page><numOfRows>0</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg></LawSearch>'
          },
          {
            path: "/DRF/lawService.do",
            params: {
              ID: "001766",
              target: "law",
              type: "XML",
              efYd: "20260419"
            },
            status: 200,
            bodyFile: path.join(fixturesDir, "san-an-law-detail.xml")
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const child = spawn(path.join(process.cwd(), "node_modules", ".bin", "tsx"), ["scripts/law-mcp-server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LAW_API_KEY: "test-law-api-key",
      LAW_MCP_HOST: "127.0.0.1",
      LAW_MCP_PORT: String(port),
      OPEN_LAW_FETCH_OVERRIDE_FILE: overridePath,
      LAW_MCP_UPSTREAM_LOG_FILE: upstreamLogPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const started = {
    baseUrl: `http://127.0.0.1:${port}`,
    process: child,
    tempRoot,
    upstreamLogPath
  };

  await waitForHealth(started.baseUrl);
  startedServers.push(started);

  return started;
}

async function stopLawMcpServer(started: StartedServer) {
  if (started.process.exitCode === null && !started.process.killed) {
    started.process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      started.process.once("exit", () => resolve());
      setTimeout(() => {
        started.process.kill("SIGKILL");
        resolve();
      }, 5_000);
    });
  }

  await rm(started.tempRoot, { recursive: true, force: true });
}

afterEach(async () => {
  while (startedServers.length > 0) {
    const started = startedServers.pop();

    if (started) {
      await stopLawMcpServer(started);
    }
  }
});

describe("law-mcp-server", () => {
  test("serves health and the three lookup endpoints against override upstream XML", async () => {
    const started = await startLawMcpServer();
    const beforeTempDirCount = await countLawMcpTempDirs();

    const healthResponse = await fetch(`${started.baseUrl}/health`);
    const lawResponse = await fetch(`${started.baseUrl}/laws/lookup?title=${encodeURIComponent("산업안전보건법")}`);
    const articleResponse = await fetch(`${started.baseUrl}/articles/lookup?lawId=001766&articleNo=${encodeURIComponent("제10조")}`);
    const effectiveResponse = await fetch(
      `${started.baseUrl}/articles/effective-range?lawId=001766&articleNo=${encodeURIComponent("제10조")}&referenceDate=2026-04-19`
    );
    const missingResponse = await fetch(`${started.baseUrl}/laws/lookup?title=${encodeURIComponent("없는법")}`);

    expect(await healthResponse.json()).toEqual({
      ok: true,
      upstream: "open.law.go.kr"
    });
    expect(await lawResponse.json()).toEqual({
      lawId: "001766",
      title: "산업안전보건법"
    });
    expect(await articleResponse.json()).toMatchObject({
      lawId: "001766",
      articleNo: "제10조",
      paragraph: null,
      item: null,
      latestArticleVersionId: "001766:제10조:2025-10-01"
    });
    expect(await effectiveResponse.json()).toEqual({
      effectiveFrom: "2025-10-01",
      effectiveTo: null,
      repealedAt: null
    });
    expect(missingResponse.status).toBe(404);

    const afterTempDirCount = await countLawMcpTempDirs();
    expect(afterTempDirCount).toBe(beforeTempDirCount);
  }, 15_000);

  test("serves repeated lookups from cache without a second upstream fetch", async () => {
    const started = await startLawMcpServer();

    const first = await fetch(`${started.baseUrl}/articles/lookup?lawId=001766&articleNo=${encodeURIComponent("제10조")}`);
    const second = await fetch(`${started.baseUrl}/articles/lookup?lawId=001766&articleNo=${encodeURIComponent("제10조")}`);
    const logLines = (await readFile(started.upstreamLogPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((line) => line.includes("/DRF/lawService.do"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(logLines).toHaveLength(1);
  }, 15_000);
});
