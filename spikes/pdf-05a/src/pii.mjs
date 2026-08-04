// Synthetic (fictional) PII planted into the scanned fixtures. NOT real people.

export const PII = {
  name: 'ישראל ישראלי', // synthetic Hebrew full name
  id: '123456782', // 9-digit Israeli-ID-shaped, synthetic
  phone: '052-1234567',
};

// Hebrew, non-cursive: reversing the whole line gives correct RTL VISUAL order
// (letters within a word and word order both flip). Used only for rendering the
// raster "scan" so it looks like a real Hebrew page to OCR.
export function toVisual(logical) {
  return [...logical].reverse().join('');
}

// Every string a leak scanner / re-OCR must fail to find after redaction.
export function piiStrings() {
  return [PII.name, PII.id, PII.phone];
}
