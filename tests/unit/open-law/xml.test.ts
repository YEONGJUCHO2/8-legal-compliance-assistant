// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { parseLawDetail, parseSearchResponse } from "@/lib/open-law/xml";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "open-law");

describe("open-law xml parsers", () => {
  test("parses search responses into normalized search rows", async () => {
    const xml = await readFile(path.join(fixturesDir, "san-an-search.xml"), "utf8");

    const results = parseSearchResponse(xml);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      mst: "001",
      lawId: "LSA001",
      title: "산업안전보건법",
      promulgationDate: "2024-01-09",
      enforcementDate: "2024-01-09"
    });
  });

  test("parses law detail responses into law/article/appendix chunks", async () => {
    const xml = await readFile(path.join(fixturesDir, "san-an-detail.xml"), "utf8");

    const detail = parseLawDetail(xml);

    expect(detail.law).toMatchObject({
      mst: "001",
      lawId: "LSA001",
      title: "산업안전보건법",
      shortTitle: "산안법"
    });
    expect(detail.articles).toHaveLength(5);
    expect(detail.articles[1]).toMatchObject({
      articleNo: "제10조",
      kind: "article"
    });
    expect(detail.articles[2]).toMatchObject({
      articleNo: "제10조",
      paragraph: "1",
      kind: "paragraph"
    });
    expect(detail.articles[3]).toMatchObject({
      articleNo: "제10조",
      paragraph: "1",
      item: "1",
      kind: "item"
    });
    expect(detail.appendices).toEqual([
      expect.objectContaining({
        label: "별표 1",
        kind: "appendix",
        title: "위험기계의 종류"
      })
    ]);
  });
});
