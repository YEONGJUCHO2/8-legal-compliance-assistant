import { describe, expect, test } from "vitest";

import { MCPResponseError, createKoreanLawMcpClient } from "@/lib/open-law/mcp-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("createKoreanLawMcpClient", () => {
  test("maps typed lookup responses from fetchImpl", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname.endsWith("/laws/lookup")) {
        return jsonResponse({
          lawId: "law-1",
          title: "산업안전보건법"
        });
      }

      if (url.pathname.endsWith("/articles/lookup")) {
        return jsonResponse({
          lawId: "law-1",
          articleNo: "제10조",
          paragraph: null,
          item: null,
          body: "사업주는 필요한 안전조치를 하여야 한다.",
          snapshotHash: "mcp-snap-1",
          latestArticleVersionId: "article-version-latest-1",
          changeSummary: null
        });
      }

      return jsonResponse({
        effectiveFrom: "2024-01-01",
        effectiveTo: null,
        repealedAt: null
      });
    };
    const client = createKoreanLawMcpClient({
      baseUrl: "https://mcp.example.test",
      fetchImpl
    });

    await expect(client.lookupLaw("산업안전보건법")).resolves.toEqual({
      lawId: "law-1",
      title: "산업안전보건법"
    });
    await expect(
      client.lookupArticle({
        lawId: "law-1",
        articleNo: "제10조"
      })
    ).resolves.toMatchObject({
      lawId: "law-1",
      articleNo: "제10조",
      snapshotHash: "mcp-snap-1"
    });
    await expect(
      client.queryEffectiveDate({
        lawId: "law-1",
        articleNo: "제10조",
        referenceDate: "2025-01-01"
      })
    ).resolves.toEqual({
      effectiveFrom: "2024-01-01",
      effectiveTo: null,
      repealedAt: null
    });
  });

  test("throws MCPResponseError on malformed responses", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        wrong: true
      });
    const client = createKoreanLawMcpClient({
      baseUrl: "https://mcp.example.test",
      fetchImpl
    });

    await expect(client.lookupLaw("산안법")).rejects.toBeInstanceOf(MCPResponseError);
  });
});
