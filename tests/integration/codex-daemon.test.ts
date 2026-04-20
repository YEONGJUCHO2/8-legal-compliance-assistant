// @vitest-environment node

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { afterEach, describe, expect, test } from "vitest";

import { engineOutputJsonSchemas } from "@/lib/assistant/schemas";

const DAEMON_TEMP_PREFIX = "legal-compliance-codex-daemon-";

type StartedDaemon = {
  authToken: string;
  baseUrl: string;
  homeDir: string;
  logPath: string;
  process: ChildProcess;
  tempRoot: string;
};

const startedDaemons: StartedDaemon[] = [];

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

async function countDaemonTempDirs() {
  const entries = await readdir(tmpdir(), { withFileTypes: true });

  return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(DAEMON_TEMP_PREFIX)).length;
}

async function writeFakeCodex(tempRoot: string) {
  const binDir = path.join(tempRoot, "bin");
  const scriptPath = path.join(binDir, "codex");

  await mkdir(binDir, { recursive: true });
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write((process.env.FAKE_CODEX_VERSION || "codex-cli 0.121.0-fake") + "\\n");
  process.exit(0);
}

if (args[0] !== "exec") {
  process.stderr.write("unexpected_args\\n");
  process.exit(1);
}

let outputFile = "";
let resume = null;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--output-last-message") {
    outputFile = args[index + 1] || "";
  }
}

if (args[1] === "resume") {
  resume = args[args.length - 2] || null;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const counterPath = process.env.FAKE_CODEX_COUNTER;
  let count = 1;
  if (counterPath) {
    try {
      count = Number(fs.readFileSync(counterPath, "utf8")) + 1;
    } catch {}
    fs.writeFileSync(counterPath, String(count));
  }

  const mode = process.env.FAKE_CODEX_MODE || "success";
  const rollout = "rollout-" + String(count).padStart(3, "0");
  if (process.env.FAKE_CODEX_LOG) {
    fs.appendFileSync(
      process.env.FAKE_CODEX_LOG,
      JSON.stringify({ count, mode, resume, input, args, promptArg: args[args.length - 1] || null }) + "\\n"
    );
  }

  process.stdout.write(JSON.stringify({ type: "turn.started", rollout_id: rollout }) + "\\n");

  if (mode === "timeout") {
    setTimeout(() => {
      process.exit(0);
    }, Number(process.env.FAKE_CODEX_SLEEP_MS || "250"));
    return;
  }

  if (mode === "schema-retry" && count === 1) {
    fs.writeFileSync(outputFile, "{not valid json");
    process.stdout.write(JSON.stringify({ type: "turn.completed", rollout_id: rollout }) + "\\n");
    process.exit(0);
    return;
  }

  fs.writeFileSync(
    outputFile,
    JSON.stringify({
      verified_facts: ["프레스 작업 전 안전장치 점검이 필요하다."],
      conclusion: "fake codex answer " + count,
      explanation: "fake explanation",
      caution: "fake caution",
      answered_scope: null,
      unanswered_scope: null,
      priority_order: null,
      collapsed_law_summary: null,
      law_sections: null
    })
  );
  process.stdout.write(JSON.stringify({ type: "turn.completed", rollout_id: rollout }) + "\\n");
  process.exit(0);
});
`,
    { mode: 0o755 }
  );

  return binDir;
}

async function waitForHealth(baseUrl: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);

      if (response.ok) {
        return response;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("daemon_health_timeout");
}

async function startDaemon(mode = "success"): Promise<StartedDaemon> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "codex-daemon-test-"));
  const homeDir = path.join(tempRoot, "home");
  const logPath = path.join(tempRoot, "fake-codex.log");
  const counterPath = path.join(tempRoot, "fake-codex.count");
  const port = await getFreePort();
  const fakeBinDir = await writeFakeCodex(tempRoot);
  const authToken = "c".repeat(64);
  await mkdir(homeDir, { recursive: true });
  const processHandle = spawn(path.join(process.cwd(), "node_modules", ".bin", "tsx"), ["scripts/codex-daemon.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      CODEX_DAEMON_HOST: "127.0.0.1",
      CODEX_DAEMON_PORT: String(port),
      CODEX_DAEMON_AUTH_TOKEN: authToken,
      CODEX_DAEMON_DISABLE_PTY: "1",
      FAKE_CODEX_MODE: mode,
      FAKE_CODEX_LOG: logPath,
      FAKE_CODEX_COUNTER: counterPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const started = {
    authToken,
    baseUrl: `http://127.0.0.1:${port}`,
    homeDir,
    logPath,
    process: processHandle,
    tempRoot
  };

  await waitForHealth(started.baseUrl);
  startedDaemons.push(started);

  return started;
}

async function stopDaemon(started: StartedDaemon) {
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

  await rm(started.tempRoot, { force: true, recursive: true });
}

async function postGenerate(baseUrl: string, body: Record<string, unknown>, authToken?: string) {
  const response = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authToken
        ? {
            Authorization: `Bearer ${authToken}`
          }
        : {})
    },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>
  };
}

afterEach(async () => {
  while (startedDaemons.length > 0) {
    const daemon = startedDaemons.pop();

    if (daemon) {
      await stopDaemon(daemon);
    }
  }
});

describe("codex daemon", () => {
  test("keeps health public and requires bearer auth on generate", async () => {
    const daemon = await startDaemon();
    const healthResponse = await fetch(`${daemon.baseUrl}/health`);
    const unauthorized = await postGenerate(
      daemon.baseUrl,
      {
        prompt: "SYSTEM\nunauthorized\n\nUSER\nquestion",
        schemaRef: "answer",
        schema: engineOutputJsonSchemas.answer,
        timeoutMs: 2000
      }
    );
    const wrongToken = await postGenerate(
      daemon.baseUrl,
      {
        prompt: "SYSTEM\nwrong\n\nUSER\nquestion",
        schemaRef: "answer",
        schema: engineOutputJsonSchemas.answer,
        timeoutMs: 2000
      },
      "wrong-token"
    );
    const authorized = await postGenerate(
      daemon.baseUrl,
      {
        prompt: "SYSTEM\nauthorized\n\nUSER\nquestion",
        schemaRef: "answer",
        schema: engineOutputJsonSchemas.answer,
        timeoutMs: 2000
      },
      daemon.authToken
    );

    expect(healthResponse.status).toBe(200);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.json).toEqual({
      error: "unauthorized"
    });
    expect(wrongToken.status).toBe(401);
    expect(wrongToken.json).toEqual({
      error: "unauthorized"
    });
    expect(authorized.status).toBe(200);
  }, 15_000);

  test("returns health and resumes codex rollouts through a stable daemon session handle", async () => {
    const daemon = await startDaemon();
    const healthResponse = await fetch(`${daemon.baseUrl}/health`);
    const health = (await healthResponse.json()) as { codex_version: string; ok: boolean };

    expect(health).toEqual({
      ok: true,
      codex_version: "codex-cli 0.121.0-fake"
    });

    const first = await postGenerate(
      daemon.baseUrl,
      {
        prompt: "SYSTEM\nfirst\n\nUSER\nquestion",
        schemaRef: "answer",
        schema: engineOutputJsonSchemas.answer,
        sessionId: "stable-session-1",
        timeoutMs: 2000
      },
      daemon.authToken
    );
    const second = await postGenerate(
      daemon.baseUrl,
      {
        prompt: "SYSTEM\nsecond\n\nUSER\nquestion",
        schemaRef: "answer",
        schema: engineOutputJsonSchemas.answer,
        sessionId: "stable-session-1",
        timeoutMs: 2000
      },
      daemon.authToken
    );
    const logLines = (await readFile(daemon.logPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { resume: string | null });

    expect(first.status).toBe(200);
    expect(first.json.sessionId).toBe("stable-session-1");
    expect(second.status).toBe(200);
    expect(second.json.sessionId).toBe("stable-session-1");
    expect(logLines[0]?.resume).toBeNull();
    expect(logLines[1]?.resume).toBe("rollout-001");
  }, 15_000);

  test("retries once on invalid JSON output and cleans up temp files", async () => {
    const beforeTempDirCount = await countDaemonTempDirs();
    const daemon = await startDaemon("schema-retry");
    const result = await postGenerate(
      daemon.baseUrl,
      {
        prompt: "SYSTEM\nretry\n\nUSER\nquestion",
        schemaRef: "answer",
        schema: engineOutputJsonSchemas.answer,
        timeoutMs: 2000
      },
      daemon.authToken
    );
    const afterTempDirCount = await countDaemonTempDirs();

    expect(result.status).toBe(200);
    expect(result.json.schemaRetries).toBe(1);
    expect(result.json.response).toMatchObject({
      conclusion: "fake codex answer 2"
    });
    expect(afterTempDirCount).toBe(beforeTempDirCount);
  }, 15_000);
});
