export type VerificationInput = {
  citations: CitationToVerify[];
  referenceDate: string;
  budgetMs: number;
  concurrency?: number;
  safetyMarginMs?: number;
};

export type CitationToVerify = {
  id: string;
  articleVersionId: string;
  lawId: string;
  lawTitle: string;
  articleNo: string;
  paragraph?: string;
  item?: string;
  localBody: string;
  localSnapshotHash: string;
  localSourceHash: string;
  position?: number;
};

export type VerifiedCitation = CitationToVerify & {
  verification_source: "mcp" | "local_only" | "missing";
  rendered_from_verification: boolean;
  disagreement: boolean;
  mcpBody?: string;
  mcpSnapshotHash?: string;
  inForce: boolean;
  answerStrengthDowngrade?: "conditional" | "verification_pending";
  verifiedAt: string | null;
  failureReason?: string;
  latestArticleVersionId?: string | null;
  changedSummary?: string | null;
};

export type VerificationOutput = {
  citations: VerifiedCitation[];
  overall: "verified" | "verification_pending" | "mcp_disagreement" | "degraded";
  partial: boolean;
  deadlineExpired: boolean;
  platformTimeoutPreempted: boolean;
};

export type StaleMark = {
  lawArticleId: string;
  lawId: string;
  snapshotHash: string;
  reason: string;
};
