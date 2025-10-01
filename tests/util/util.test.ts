
import { describe, it, expect } from 'vitest';
import { seratoEncode, seratoDecode } from '../../src/util';

describe('util', () => {
  it('encodes/decodes', () => {
    const s = 'abc';
    expect(seratoDecode(seratoEncode(s))).toBe(s);
  });
});
