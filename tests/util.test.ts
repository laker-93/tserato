import { describe, expect, it } from 'vitest';

import { unpooledBuffer } from '../src/util';

describe('unpooledBuffer', () => {
  it('copies a view that does not own its whole ArrayBuffer', () => {
    const pool = Buffer.alloc(64);
    pool.fill(7, 8, 24);
    const view = pool.subarray(8, 24);

    const owned = unpooledBuffer(view);

    expect(view.byteOffset).toBe(8);
    expect(owned.byteOffset).toBe(0);
    expect(owned.buffer.byteLength).toBe(view.length);
    expect(Buffer.compare(owned, view)).toBe(0);
  });

  it('hands back a buffer that already owns its ArrayBuffer untouched', () => {
    const buf = Buffer.alloc(16);

    expect(unpooledBuffer(buf)).toBe(buf);
  });
});
