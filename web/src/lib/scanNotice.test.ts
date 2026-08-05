import { describe, expect, it } from "vitest";
import { scanNoticeFor } from "./scanNotice";

describe("scanNoticeFor", () => {
  it("maps the low-confidence gate refusal to the low-quality notice", () => {
    expect(scanNoticeFor("Error: SCAN_LOW_CONFIDENCE")).toBe("lowQuality");
  });

  it("maps both rare internal-safety refusals to the shared unsafe notice", () => {
    expect(scanNoticeFor("SCAN_UNMAPPABLE_PII")).toBe("unsafe");
    expect(scanNoticeFor("Error: SCAN_SELFVERIFY_FAILED")).toBe("unsafe");
  });

  it("returns null for a generic error (falls through to the generic file error)", () => {
    expect(scanNoticeFor("some other failure")).toBeNull();
    expect(scanNoticeFor("")).toBeNull();
  });
});
