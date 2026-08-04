/**
 * PDF sanitization (PDF-06) — redaction removes PII from the visible page; sanitization removes it
 * from the INVISIBLE channels where it also hides. Measured (2026-08-04): `sanitize:true` does NOT
 * clear the Info dict, annotation contents, or outlines — exactly where a legal PDF carries party
 * names. We strip those explicitly here. Outlines are handled by the caller (they are user-visible
 * navigation and go through the same anonymize pass + key for coherence); this module handles the
 * pure-metadata channels.
 *
 * mupdf's WASM object API is untyped — narrowly used, behind a dynamic import at the call site.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Delete the Info dictionary (Author/Title/Subject/Keywords + timestamps) from the trailer. */
export function stripInfo(doc: any): void {
  doc.getTrailer().delete("Info");
}

/** Delete the XMP metadata stream from the document catalog. */
export function stripXmp(doc: any): void {
  const root = doc.getTrailer().get("Root");
  if (root && root.isDictionary && root.isDictionary()) {
    root.delete("Metadata");
  }
}

/** Delete every embedded file / attachment (which can carry PII in its bytes or filename). */
export function stripEmbeddedFiles(doc: any): void {
  const names: string[] = doc.getEmbeddedFiles ? Object.keys(doc.getEmbeddedFiles() ?? {}) : [];
  for (const name of names) {
    try {
      doc.deleteEmbeddedFile(name);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Clear the free-text metadata on every remaining annotation (Contents + Author). Redaction
 * annotations have already been consumed by applyRedactions; what remains is notes/comments whose
 * text can carry PII. We do not delete the annotation (it may be a visual mark) — just its PII text.
 */
export function clearAnnotationText(doc: any): void {
  const pageCount: number = doc.countPages();
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.loadPage(i);
    const annots = page.getAnnotations ? page.getAnnotations() : [];
    for (const annot of annots) {
      try {
        if (annot.setContents) {
          annot.setContents("");
        }
        if (annot.hasAuthor && annot.hasAuthor() && annot.setAuthor) {
          annot.setAuthor("");
        }
        if (annot.update) {
          annot.update();
        }
      } catch {
        /* best effort */
      }
    }
  }
}

/** Strip all pure-metadata leak channels (Info, XMP, embedded files, annotation text). */
export function sanitizeMetadata(doc: any): void {
  stripInfo(doc);
  stripXmp(doc);
  stripEmbeddedFiles(doc);
  clearAnnotationText(doc);
}

/** One outline (bookmark) node with a mutable Title. */
export interface OutlineItem {
  readonly setTitle: (title: string) => void;
  readonly title: string;
}

/**
 * Walk the outline (bookmark) tree and return every node with a getter for its title and a setter to
 * rewrite it. The caller anonymizes the titles (coherently with the body key) and writes them back.
 */
export function collectOutlineItems(doc: any): OutlineItem[] {
  const items: OutlineItem[] = [];
  const isReal = (obj: any): boolean => obj && typeof obj.get === "function" && !(obj.isNull?.() ?? false);
  const root = doc.getTrailer().get("Root");
  const outlines = isReal(root) ? root.get("Outlines") : null;
  if (!isReal(outlines)) {
    return items;
  }
  const visit = (node: any): void => {
    for (let current = node; isReal(current); current = current.get("Next")) {
      const titleObj = current.get("Title");
      if (titleObj && !(titleObj.isNull?.() ?? false) && titleObj.asString) {
        const node2 = current;
        items.push({
          title: titleObj.asString(),
          setTitle: (title: string) => node2.put("Title", doc.newString(title)),
        });
      }
      const child = current.get("First");
      if (isReal(child)) {
        visit(child);
      }
    }
  };
  visit(outlines.get("First"));
  return items;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
