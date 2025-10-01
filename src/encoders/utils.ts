export function encode(data: Buffer): Buffer {
  const a = data.readUInt8(0);
  const b = data.readUInt8(1);
  const c = data.readUInt8(2);
  const z = c & 0x7F;
  const y = ((c >> 7) | (b << 1)) & 0x7F;
  const x = ((b >> 6) | (a << 2)) & 0x7F;
  const w = a >> 5;
  return Buffer.from([w, x, y, z]);
}

export function decode(data: Buffer): Buffer {
  const w = data.readUInt8(0);
  const x = data.readUInt8(1);
  const y = data.readUInt8(2);
  const z = data.readUInt8(3);
  const c = (z & 0x7F) | ((y & 0x01) << 7);
  const b = ((y & 0x7F) >> 1) | ((x & 0x03) << 6);
  const a = ((x & 0x7F) >> 2) | ((w & 0x07) << 5);
  return Buffer.from([a, b, c]);
}
