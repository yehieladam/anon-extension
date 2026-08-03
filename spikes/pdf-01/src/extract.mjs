// Structured-text extraction helpers used by the acceptance test and probes.
import * as mupdf from 'mupdf';

// Return the full plain text of every page, concatenated.
export function extractAllText(doc) {
  let out = '';
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const stext = page.toStructuredText('preserve-whitespace');
    out += stext.asText() + '\n';
  }
  return out;
}

// Load a PDF from a file path into a PDFDocument.
export function openDoc(bytes) {
  return mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
}
