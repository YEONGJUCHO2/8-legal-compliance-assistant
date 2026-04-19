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

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      mst: "276853",
      lawId: "001766",
      title: "산업안전보건법",
      promulgationDate: "2025-10-01",
      enforcementDate: "2025-10-01"
    });
  });

  test("parses law detail responses into law/article/appendix chunks", async () => {
    const xml = await readFile(path.join(fixturesDir, "san-an-detail.xml"), "utf8");

    const detail = parseLawDetail(xml);

    expect(detail.law).toMatchObject({
      mst: null,
      lawId: "007364",
      title: "산업안전보건법 시행규칙",
      shortTitle: null,
      promulgationDate: "2025-05-30",
      enforcementDate: "2025-06-01"
    });

    expect(detail.articles).toHaveLength(12);
    expect(detail.articles[0]).toMatchObject({
      articleNo: "제1조",
      kind: "article"
    });
    expect(detail.articles[1]).toMatchObject({
      articleNo: "제3조",
      kind: "article"
    });
    expect(detail.articles[2]).toMatchObject({
      articleNo: "제3조",
      paragraph: null,
      item: "1",
      kind: "item"
    });
    expect(detail.articles[5]).toMatchObject({
      articleNo: "제4조",
      paragraph: "①",
      kind: "paragraph"
    });
    expect(detail.articles[6]).toMatchObject({
      articleNo: "제4조",
      paragraph: "①",
      item: "1",
      kind: "item"
    });
    expect(detail.articles[10]).toMatchObject({
      articleNo: "제89조의2",
      paragraph: "①",
      kind: "paragraph"
    });
    expect(detail.appendices).toEqual([
      expect.objectContaining({
        label: "별표 1",
        kind: "appendix",
        title: "건설업체 산업재해발생률 및 산업재해 발생 보고의무 위반건수의 산정 기준과 방법(제4조 관련)"
      })
    ]);
  });
});
