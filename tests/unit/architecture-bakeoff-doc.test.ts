// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

const docPath = path.join(process.cwd(), "docs", "architecture-bakeoff.md");

describe("architecture bake-off decision doc", () => {
  test("exists and includes the required decision sections", async () => {
    const markdown = await readFile(docPath, "utf8");

    expect(markdown).toMatch(/^## Decision$/m);
    expect(markdown).toMatch(/^## Options Evaluated$/m);
    expect(markdown).toMatch(/^## Winner Rationale$/m);
    expect(markdown).toMatch(/^## Phase 03 Scope Update$/m);
    expect(markdown).toMatch(/^## Phase 04 Scope Update$/m);
    expect(markdown).toMatch(/^## Provisional Status$/m);
  });
});
