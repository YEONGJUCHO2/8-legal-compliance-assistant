import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";
import { z } from "zod";

const allowedCategories = [
  "baseline-safety",
  "appendix-lookup",
  "serious-accident-liability",
  "contracting",
  "general-obligation",
  "education"
] as const;

const wedgeGoldSchema = z.object({
  minimum_required: z.literal(200),
  categories: z.array(z.enum(allowedCategories)),
  todo: z.literal("Expand to 200+ via lawyer review in post-MVP milestone"),
  items: z.array(
    z.object({
      id: z.string().min(1),
      category: z.enum(allowedCategories),
      query: z.string().min(1),
      referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      expectedLawTitle: z.string().min(1),
      expectedArticleNo: z.string().min(1)
    })
  )
});

function readWedgeGold() {
  return JSON.parse(readFileSync(path.join(process.cwd(), "evals/retrieval/wedge-gold.json"), "utf8")) as unknown;
}

describe("wedge-gold", () => {
  test("matches the retrieval gold-set schema and category inventory", () => {
    const parsed = wedgeGoldSchema.parse(readWedgeGold());

    expect(new Set(parsed.categories)).toEqual(new Set(allowedCategories));
    expect(parsed.items.length).toBeGreaterThanOrEqual(8);
    expect(parsed.items.length).toBeLessThanOrEqual(10);
  });

  test("keeps category values in the allowed set with no duplicate ids", () => {
    const parsed = wedgeGoldSchema.parse(readWedgeGold());
    const ids = parsed.items.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(parsed.items.every((item) => allowedCategories.includes(item.category))).toBe(true);
  });
});
