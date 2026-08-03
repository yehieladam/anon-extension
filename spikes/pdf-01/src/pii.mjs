// Synthetic (fictional) PII planted into the fixtures. NOT real people.
// Used by the fixture builders and the acceptance test.

export const PII = {
  latin: {
    name: 'John Smith',
    id: '123456782', // 9-digit Israeli-ID-shaped, synthetic
    phone: '052-1234567',
  },
  hebrew: {
    name: 'ישראל ישראלי',
    id: '123456782',
    phone: '052-1234567',
  },
};

// All the strings a leak scanner must hunt for, per fixture.
export function piiStrings(kind) {
  const p = PII[kind];
  return [p.name, p.id, p.phone];
}
