import { getEnv } from "@/lib/env";
import type { OpenLawFetchImpl } from "@/lib/open-law/types";

const OPEN_LAW_BASE_URL = "https://www.law.go.kr/DRF";

function resolveTimeoutMs(timeoutMs?: number) {
  if (timeoutMs !== undefined) {
    return timeoutMs;
  }

  try {
    return getEnv().RETRIEVAL_DEADLINE_MS;
  } catch {
    return 8_000;
  }
}

function resolveOc(oc?: string) {
  if (oc) {
    return oc;
  }

  return getEnv().LAW_API_KEY;
}

async function fetchXml({
  url,
  fetchImpl = fetch,
  timeoutMs
}: {
  url: URL;
  fetchImpl?: OpenLawFetchImpl;
  timeoutMs?: number;
}) {
  const response = await fetchImpl(url, {
    method: "GET",
    signal: AbortSignal.timeout(resolveTimeoutMs(timeoutMs))
  });

  if (!response.ok) {
    throw new Error(`open-law request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

export async function searchLaws({
  query,
  referenceDate,
  oc,
  target,
  type,
  fetchImpl,
  timeoutMs
}: {
  query: string;
  referenceDate: string;
  oc?: string;
  target?: string;
  type?: string;
  fetchImpl?: OpenLawFetchImpl;
  timeoutMs?: number;
}) {
  const url = new URL(`${OPEN_LAW_BASE_URL}/lawSearch.do`);
  url.searchParams.set("OC", resolveOc(oc));
  url.searchParams.set("query", query);
  url.searchParams.set("target", target ?? "law");
  url.searchParams.set("type", type ?? "XML");
  url.searchParams.set("date", referenceDate);

  return fetchXml({ url, fetchImpl, timeoutMs });
}

export async function getLawDetail({
  mst,
  lawId,
  referenceDate,
  oc,
  fetchImpl,
  timeoutMs
}: {
  mst?: string;
  lawId?: string;
  referenceDate: string;
  oc?: string;
  fetchImpl?: OpenLawFetchImpl;
  timeoutMs?: number;
}) {
  if (!mst && !lawId) {
    throw new Error("Either mst or lawId is required for getLawDetail");
  }

  const url = new URL(`${OPEN_LAW_BASE_URL}/lawService.do`);
  url.searchParams.set("OC", resolveOc(oc));
  url.searchParams.set("type", "XML");
  url.searchParams.set("date", referenceDate);

  if (mst) {
    url.searchParams.set("MST", mst);
  }

  if (lawId) {
    url.searchParams.set("ID", lawId);
  }

  return fetchXml({ url, fetchImpl, timeoutMs });
}
