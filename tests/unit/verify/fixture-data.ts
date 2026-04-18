import type { CitationToVerify, VerifiedCitation } from "@/lib/verify/types";

export function createVerificationCitations(): CitationToVerify[] {
  return [
    {
      id: "article-1",
      articleVersionId: "article-version-1",
      lawId: "law-1",
      lawTitle: "산업안전보건법",
      articleNo: "제10조",
      paragraph: undefined,
      item: undefined,
      localBody: "사업주는 필요한 안전조치를 하여야 한다.",
      localSnapshotHash: "local-snap-1",
      localSourceHash: "local-source-1",
      position: 0
    },
    {
      id: "article-2",
      articleVersionId: "article-version-2",
      lawId: "law-2",
      lawTitle: "중대재해 처벌 등에 관한 법률",
      articleNo: "제4조",
      paragraph: undefined,
      item: undefined,
      localBody: "사업주 또는 경영책임자는 안전보건 확보의무를 이행해야 한다.",
      localSnapshotHash: "local-snap-2",
      localSourceHash: "local-source-2",
      position: 1
    },
    {
      id: "article-3",
      articleVersionId: "article-version-3",
      lawId: "law-3",
      lawTitle: "산업안전보건법",
      articleNo: "제15조",
      paragraph: undefined,
      item: undefined,
      localBody: "안전관리자를 선임해야 한다.",
      localSnapshotHash: "local-snap-3",
      localSourceHash: "local-source-3",
      position: 2
    }
  ];
}

export function createVerifiedCitation(overrides: Partial<VerifiedCitation> = {}): VerifiedCitation {
  return {
    id: "article-1",
    articleVersionId: "article-version-1",
    lawId: "law-1",
    lawTitle: "산업안전보건법",
    articleNo: "제10조",
    paragraph: undefined,
    item: undefined,
    localBody: "사업주는 필요한 안전조치를 하여야 한다.",
    localSnapshotHash: "local-snap-1",
    localSourceHash: "local-source-1",
    position: 0,
    verification_source: "local_only",
    rendered_from_verification: false,
    disagreement: false,
    inForce: true,
    verifiedAt: "2026-04-17T00:00:00.000Z",
    failureReason: undefined,
    latestArticleVersionId: null,
    changedSummary: null,
    ...overrides
  };
}
