import { MVP_LAW_TITLES } from "@/lib/open-law/mvp-corpus";

function normalizeAliasKey(value: string) {
  return normalizeTitle(value).toLowerCase();
}

export function normalizeTitle(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[·ㆍᆞ]/g, " ")
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s*\)\s*/g, ") ")
    .replace(/\s+/g, " ")
    .trim();
}

const RAW_ALIAS_DICTIONARY: Record<string, string> = {
  산안법: "산업안전보건법",
  "산안법 시행령": "산업안전보건법 시행령",
  "산안법 시행규칙": "산업안전보건법 시행규칙",
  안전보건기준: "산업안전보건기준에 관한 규칙",
  "안전보건기준 규칙": "산업안전보건기준에 관한 규칙",
  중처법: "중대재해 처벌 등에 관한 법률",
  "중처법 시행령": "중대재해 처벌 등에 관한 법률 시행령",
  "유해위험작업 취업제한 규칙": "유해·위험작업의 취업 제한에 관한 규칙",
  "유해위험작업 취업 제한 규칙": "유해·위험작업의 취업 제한에 관한 규칙",
  "유해위험작업의 취업 제한에 관한 규칙": "유해·위험작업의 취업 제한에 관한 규칙",
  건진법: "건설기술 진흥법",
  "건진법 시행령": "건설기술 진흥법 시행령",
  근기법: "근로기준법"
};

export const ALIAS_DICTIONARY = Object.freeze(
  Object.fromEntries(
    [...Object.entries(RAW_ALIAS_DICTIONARY), ...MVP_LAW_TITLES.map((title) => [title, title] as const)].map(
      ([alias, canonical]) => [normalizeAliasKey(alias), canonical]
    )
  )
);

export function resolveAlias(input: string) {
  return ALIAS_DICTIONARY[normalizeAliasKey(input)] ?? normalizeTitle(input);
}
