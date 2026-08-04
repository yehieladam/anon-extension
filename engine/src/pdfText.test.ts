import { describe, expect, it } from "vitest";
import { buildMappedText, quadsForSpan, refsToRects, type PageLines } from "./pdfText";

/** A char box at [x0,x1] × [y0,y1] (quad = ul, ur, ll, lr corners). */
function box(char: string, x0: number, x1: number, y0: number, y1: number) {
  return { char, quad: [x0, y0, x1, y0, x0, y1, x1, y1] };
}

/** One page, one line of the given char boxes (wrapped as the pages array buildMappedText takes). */
function page(chars: ReturnType<typeof box>[]): PageLines[] {
  return [{ pageIndex: 0, lines: [{ chars }] }];
}

describe("buildMappedText", () => {
  it("concatenates chars into text with a ref per code unit and nulls at separators", () => {
    const pages: PageLines[] = [
      {
        pageIndex: 0,
        lines: [
          { chars: [box("A", 0, 10, 0, 10), box("B", 10, 20, 0, 10)] },
          { chars: [box("C", 0, 10, 20, 30)] },
        ],
      },
    ];
    const mapped = buildMappedText(pages);
    expect(mapped.text).toBe("AB\nC");
    expect(mapped.refs).toHaveLength(4);
    expect(mapped.refs[0]?.quad[0]).toBe(0); // A
    expect(mapped.refs[1]?.quad[0]).toBe(10); // B
    expect(mapped.refs[2]).toBeNull(); // "\n"
    expect(mapped.refs[3]?.quad[4]).toBe(0); // C, ll x
  });
});

describe("quadsForSpan", () => {
  it("returns the distinct quads a span covers", () => {
    const mapped = buildMappedText(page([box("1", 0, 5, 0, 10), box("2", 5, 10, 0, 10)]));
    expect(quadsForSpan(mapped, 0, 2)).toHaveLength(2);
    expect(quadsForSpan(mapped, 0, 1)).toHaveLength(1);
  });
});

describe("refsToRects", () => {
  it("merges same-line adjacent chars into one rect", () => {
    const mapped = buildMappedText(
      page([box("1", 10, 20, 100, 120), box("2", 20, 30, 100, 120), box("3", 30, 40, 100, 120)]),
    );
    const rects = refsToRects(quadsForSpan(mapped, 0, 3));
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ pageIndex: 0, x0: 10, x1: 40, y0: 100, y1: 120 });
  });

  it("produces a rect per line when a value wraps across lines", () => {
    const pages: PageLines = {
      pageIndex: 0,
      lines: [{ chars: [box("A", 10, 20, 100, 120)] }, { chars: [box("B", 10, 20, 200, 220)] }],
    };
    const mapped = buildMappedText([pages]);
    // offsets: A=0, "\n"=1, B=2 → span the two glyphs (skip the separator ref, which is null)
    const rects = refsToRects(quadsForSpan(mapped, 0, 3));
    expect(rects).toHaveLength(2);
    expect(rects[0].y0).toBe(100);
    expect(rects[1].y0).toBe(200);
  });
});
