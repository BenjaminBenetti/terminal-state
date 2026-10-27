// Minimal RIFF/WAVE PCM reader/writer (16-bit integer PCM, any channel count). Node stdlib only.

/** @returns {{sampleRate: number, channels: Float32Array[], bits: number}} */
export function readWav(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = {format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), sampleRate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14)};
    else if (id === 'data') data = b.subarray(body, Math.min(b.length, body + size));
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt/data chunk');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`unsupported WAV format ${fmt.format}/${fmt.bits}-bit`);
  const n = Math.floor(data.length / (2 * fmt.channels));
  const channels = Array.from({length: fmt.channels}, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.channels; c++) channels[c][i] = data.readInt16LE((i * fmt.channels + c) * 2) / 32768;
  return {sampleRate: fmt.sampleRate, channels, bits: 16};
}

/** Float [-1,1] -> Int16 with rounding + hard clip (no dither: levels are well above the LSB). */
export function toInt16(x) {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
}

export function writeWav(channels, sampleRate) {
  const ch = channels.length, n = channels[0].length;
  const b = Buffer.alloc(44 + n * ch * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * ch * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(n * ch * 2, 40);
  const ints = channels.map(toInt16);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) b.writeInt16LE(ints[c][i], 44 + (i * ch + c) * 2);
  return b;
}
