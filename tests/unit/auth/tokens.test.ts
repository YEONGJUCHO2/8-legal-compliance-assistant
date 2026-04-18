import { describe, expect, test } from "vitest";

import { generateState, generateToken, hashToken } from "@/lib/auth/tokens";

describe("auth tokens", () => {
  test("generates base64url magic-link tokens from 32 random bytes", () => {
    const token = generateToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBe(43);
  });

  test("generates base64url CSRF states from 16 random bytes", () => {
    const state = generateState();

    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state.length).toBe(22);
  });

  test("hashes tokens deterministically with sha-256 hex", () => {
    const token = "sample-token";

    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });
});
