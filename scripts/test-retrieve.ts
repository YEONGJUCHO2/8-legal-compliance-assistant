import { createDbLawStorage } from "../src/lib/db/storage";
import { normalizeQuery } from "../src/lib/search/normalize-query";
import { filterByEffectiveDate } from "../src/lib/search/filter";
import { rankCandidates } from "../src/lib/search/rank";

async function main() {
  const storage = createDbLawStorage();
  const query = "비계 설치 자격 요건";
  const referenceDate = "2026-04-19";
  const normalized = normalizeQuery(query);
  console.log("tokens:", JSON.stringify(normalized.tokens));

  const lex = await storage.findArticlesByLexical(normalized.tokens, { referenceDate, limit: 15 });
  console.log("lexical candidates:", lex.length);
  for (const c of lex.slice(0, 5)) {
    console.log(
      "  ·",
      c.law_title,
      c.article_no,
      "effective_from=",
      c.effective_from,
      "effective_to=",
      c.effective_to
    );
  }

  const filtered = filterByEffectiveDate(lex, referenceDate);
  console.log("after effective-date filter:", filtered.length);

  const ranked = rankCandidates(normalized.tokens, normalized.articleNumberHints, filtered, { referenceDate });
  console.log("after ranking:", ranked.length);

  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
