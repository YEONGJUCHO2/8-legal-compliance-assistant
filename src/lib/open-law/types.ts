export type OpenLawFetchImpl = typeof fetch;

export type SearchLawResult = {
  mst: string | null;
  lawId: string | null;
  title: string;
  promulgationDate: string | null;
  enforcementDate: string | null;
};

export type OpenLawLawDocument = {
  mst: string | null;
  lawId: string | null;
  title: string;
  shortTitle: string | null;
  promulgationDate: string | null;
  enforcementDate: string | null;
  sourceUrl: string | null;
};

export type OpenLawArticle = {
  articleNo: string;
  paragraph: string | null;
  item: string | null;
  kind: "article" | "paragraph" | "item";
  title: string | null;
  body: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  repealedAt: string | null;
  articlePath: string;
};

export type OpenLawAppendix = {
  label: string;
  title: string;
  body: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  articlePath: string;
  kind: "appendix";
};

export type ParsedLawDetail = {
  law: OpenLawLawDocument;
  articles: OpenLawArticle[];
  appendices: OpenLawAppendix[];
};

export type StoredLawDocument = {
  id: string;
  mst: string | null;
  lawId: string | null;
  title: string;
  shortTitle: string | null;
  promulgationDate: string | null;
  enforcementDate: string | null;
  sourceUrl: string | null;
  sourceHash: string;
};

export type LawArticleKey = {
  lawDocumentId: string;
  articleNo: string;
  paragraph: string | null;
  item: string | null;
  kind: "article" | "paragraph" | "item" | "appendix";
};

export type StoredLawArticle = LawArticleKey & {
  id: string;
  title: string | null;
  body: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  repealedAt: string | null;
  contentHash: string;
  version: number;
};

export type LawArticleVersionInput = {
  articleId: string;
  version: number;
  body: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  repealedAt: string | null;
  contentHash: string;
  changeType: string;
};

export interface SyncStore {
  getLawDocumentByExternalId(key: {
    mst?: string | null;
    lawId?: string | null;
  }): Promise<StoredLawDocument | null>;
  saveLawDocument(input: Omit<StoredLawDocument, "id">): Promise<StoredLawDocument>;
  getLawArticle(key: LawArticleKey): Promise<StoredLawArticle | null>;
  saveLawArticle(input: Omit<StoredLawArticle, "id"> & { id?: string }): Promise<StoredLawArticle>;
  appendLawArticleVersion(input: LawArticleVersionInput): Promise<void>;
}

export type SyncSummary = {
  targetsProcessed: number;
  documentsSynced: number;
  documentsSkippedBySourceHash: number;
  createdArticles: number;
  updatedArticles: number;
  versionRowsCreated: number;
  dryRun: boolean;
};
