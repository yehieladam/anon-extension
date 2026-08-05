/**
 * MIME lookup must always return a STRING (it feeds `new Blob({ type })`), even for a hostile file
 * name that would resolve to an inherited property on a normal object (`x.__proto__`, `x.constructor`).
 */
import { describe, expect, it } from "vitest";
import { mimeFor } from "./mime";

describe("mimeFor", () => {
  it("resolves the real extensions", () => {
    expect(mimeFor("report.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mimeFor("book.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(mimeFor("doc.PDF")).toBe("application/pdf"); // case-insensitive
    expect(mimeFor("notes.txt")).toBe("text/plain;charset=utf-8");
    expect(mimeFor("data.csv")).toBe("text/csv;charset=utf-8");
  });

  it("returns the safe default for a prototype-polluting name (the headline case)", () => {
    expect(mimeFor("evil.__proto__")).toBe("application/octet-stream");
  });

  it("returns the default for constructor/toString, not just __proto__", () => {
    expect(mimeFor("x.constructor")).toBe("application/octet-stream");
    expect(mimeFor("x.toString")).toBe("application/octet-stream");
  });

  it("returns the default for a missing or unknown extension", () => {
    expect(mimeFor("noextension")).toBe("application/octet-stream");
    expect(mimeFor("x.zzz")).toBe("application/octet-stream");
  });

  it("always returns a string", () => {
    for (const name of ["a.docx", "evil.__proto__", "x.constructor", "noext", "x.zzz"]) {
      expect(typeof mimeFor(name)).toBe("string");
    }
  });
});
