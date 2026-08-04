/**
 * EMAIL_ADDRESS — RFC-sane structural match incl. Israeli .co.il; no false hits on Hebrew prose.
 */
import { describe, expect, it } from "vitest";
import { emailRecognizer } from "./email";

const VALID = [
  "yossi@example.com",
  "cohen.law@office.co.il",
  "a_b+tag@sub.domain.org",
  "test123@gmail.com",
];

describe("emailRecognizer", () => {
  it.each(VALID)("detects %s", (addr) => {
    const spans = emailRecognizer.recognize(addr);
    expect(spans).toHaveLength(1);
    expect(addr.slice(spans[0].start, spans[0].end)).toBe(addr);
    expect(spans[0].type).toBe("EMAIL_ADDRESS");
  });

  it("finds an email inside a Hebrew sentence and excludes the trailing period", () => {
    const text = "אפשר לפנות אליי בכתובת cohen.law@office.co.il.";
    const spans = emailRecognizer.recognize(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("cohen.law@office.co.il");
  });

  it("does not fire on plain Hebrew text", () => {
    expect(emailRecognizer.recognize("שלום, זהו טקסט בעברית ללא כתובת דוא״ל")).toHaveLength(0);
  });

  it("does not fire on an @ with no local part or no TLD", () => {
    expect(emailRecognizer.recognize("@nohandle.com")).toHaveLength(0);
    expect(emailRecognizer.recognize("user@localhost")).toHaveLength(0);
  });

  it("detects multiple addresses in one text", () => {
    const text = "שלחו ל־a@x.co.il ול־b@y.com";
    const values = emailRecognizer.recognize(text).map((s) => text.slice(s.start, s.end));
    expect(values).toEqual(["a@x.co.il", "b@y.com"]);
  });
});
