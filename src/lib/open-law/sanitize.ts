import { createHash } from "node:crypto";

import pino from "pino";

const logger = pino({
  name: "open-law-sanitize",
  level: process.env.NODE_ENV === "test" ? "silent" : "info"
});

const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
const SCRIPT_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script>/giu;
const IFRAME_PATTERN = /<iframe\b[^>]*>[\s\S]*?<\/iframe>/giu;
const DATA_URI_PATTERN = /data:text\/html[^ \n\r\t]*/giu;
const HTML_ATTRIBUTE_PATTERN = /\bon[a-z]+\s*=\s*(['"]).*?\1/giu;
const HTML_TAG_PATTERN = /<\/?[^>]+>/gu;
const AMENDMENT_REASON_PATTERN = /개정이유\s*[:：]?.*$/giu;
const INVALID_LINE_BREAKS_PATTERN = /\r\n?/gu;
const ALLOWED_CHAR_PATTERN =
  /[\p{Script=Hangul}\p{Script=Han}A-Za-z0-9\s.,;:!?()\-–—_/[\]{}'"“”‘’%&+*=~|·ㆍ•※#@]/u;

export const ALLOWED_TEXT_PATTERN =
  /^(?:[\p{Script=Hangul}\p{Script=Han}A-Za-z0-9\s.,;:!?()\-–—_/[\]{}'"“”‘’%&+*=~|·ㆍ•※#@])*$/u;

export const sanitizationHooks = {
  onDrop({
    reason,
    excerpt
  }: {
    reason: string;
    excerpt: string;
  }) {
    logger.warn({ reason, excerpt }, "Dropped unsafe law corpus content");
  }
};

export function logSanitizationDrop({
  reason,
  excerpt
}: {
  reason: string;
  excerpt: string;
}) {
  sanitizationHooks.onDrop({ reason, excerpt });
}

function applyDropPattern(value: string, pattern: RegExp, reason: string) {
  if (!pattern.test(value)) {
    return value;
  }

  logSanitizationDrop({
    reason,
    excerpt: value.slice(0, 120)
  });

  pattern.lastIndex = 0;
  return value.replace(pattern, " ");
}

export function sanitizeLawText(raw: string) {
  let sanitized = raw.normalize("NFC").replace(INVALID_LINE_BREAKS_PATTERN, "\n");

  if (CONTROL_CHAR_PATTERN.test(sanitized)) {
    logSanitizationDrop({
      reason: "control_character",
      excerpt: sanitized.slice(0, 120)
    });
    CONTROL_CHAR_PATTERN.lastIndex = 0;
    sanitized = sanitized.replace(CONTROL_CHAR_PATTERN, "");
  }

  sanitized = applyDropPattern(sanitized, SCRIPT_PATTERN, "script_tag");
  sanitized = applyDropPattern(sanitized, IFRAME_PATTERN, "iframe_tag");
  sanitized = applyDropPattern(sanitized, DATA_URI_PATTERN, "data_uri");
  sanitized = applyDropPattern(sanitized, HTML_ATTRIBUTE_PATTERN, "html_attribute");
  sanitized = applyDropPattern(sanitized, AMENDMENT_REASON_PATTERN, "amendment_reason");
  sanitized = sanitized.replace(HTML_TAG_PATTERN, " ");

  const invalidChars = [...sanitized].filter((char) => !ALLOWED_CHAR_PATTERN.test(char));
  if (invalidChars.length > 0) {
    logSanitizationDrop({
      reason: "disallowed_character",
      excerpt: invalidChars.join("").slice(0, 40)
    });
    sanitized = [...sanitized].filter((char) => ALLOWED_CHAR_PATTERN.test(char)).join("");
  }

  return sanitized.replace(/\s+/g, " ").trim();
}

export function computeSourceHash(rawXml: string) {
  return createHash("sha256").update(rawXml, "utf8").digest("hex");
}

export function computeContentHash(sanitizedBody: string) {
  return createHash("sha256").update(sanitizedBody, "utf8").digest("hex");
}
