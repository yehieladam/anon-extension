import { describe, expect, it } from "vitest";
import { installTokenizerShim, isTokenizerShimInstalled } from "./tokenizerShim";

// The pattern that actually broke Phase 0: a gershayim escape inside a /u-flagged
// pretokenizer regex. Kept verbatim so this test fails if the shim ever stops covering
// the real-world case rather than a synthetic one.
const GERSHAYIM_PATTERN = '[\\"\\\']';

describe("tokenizerShim", () => {
  it("proves the unpatched constructor rejects the dictabert pattern", () => {
    // Guard the premise: if V8 ever accepts this, the shim is obsolete, not merely idle.
    expect(isTokenizerShimInstalled()).toBe(false);
    expect(() => new RegExp(GERSHAYIM_PATTERN, "u")).toThrow(SyntaxError);
  });

  it("compiles the dictabert pattern once installed, matching the bare characters", () => {
    installTokenizerShim();
    expect(isTokenizerShimInstalled()).toBe(true);

    const re = new RegExp(GERSHAYIM_PATTERN, "u");
    expect(re.test('ח"פ')).toBe(true);
    expect(re.test("ת'ז")).toBe(true);
    expect(re.test("שלום")).toBe(false);
  });

  it("is idempotent", () => {
    installTokenizerShim();
    installTokenizerShim();
    expect(new RegExp(GERSHAYIM_PATTERN, "u").test('ח"פ')).toBe(true);
  });

  it("leaves genuine escapes and metacharacters intact under /u", () => {
    expect(new RegExp("\\d+", "u").exec("abc 123")?.[0]).toBe("123");
    expect(new RegExp("\\w+", "u").test("word")).toBe(true);
    expect(new RegExp("a\\.b", "u").test("a.b")).toBe(true);
    expect(new RegExp("a\\.b", "u").test("axb")).toBe(false);
    expect(new RegExp("\\p{Script=Hebrew}", "u").test("א")).toBe(true);
  });

  it("does not touch patterns without the u or v flag", () => {
    // Legal without /u, and the shim must not rewrite it.
    expect(new RegExp('\\"', "g").test('say "hi"')).toBe(true);
  });

  it("still throws on patterns that are broken for reasons sanitizing cannot fix", () => {
    // eslint-disable-next-line no-invalid-regexp -- the invalidity is the assertion
    expect(() => new RegExp("(unclosed", "u")).toThrow(SyntaxError);
  });

  it("accepts RegExp inputs and preserves instanceof", () => {
    const source = new RegExp("abc", "u");
    expect(new RegExp(source).source).toBe("abc");
    expect(new RegExp("abc", "u")).toBeInstanceOf(RegExp);
  });
});
