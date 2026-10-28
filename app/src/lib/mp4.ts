// A small MP4 writer for H.264 video from the browser's own encoder (WebCodecs):
// the encoded frames, each at its exact time, into a standard .mp4 that plays
// anywhere (phones, PowerPoint, WhatsApp). One video track, no sound, the index
// before the data so it starts playing while it downloads.

export type Sample = { data: Uint8Array; key: boolean };

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, ...parts: (number[] | Uint8Array)[]) => {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(size);
  out.set([...u32(size), ...ascii(type)]);
  let at = 8;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const full = (type: string, version: number, flags: number, ...parts: (number[] | Uint8Array)[]) => box(type, [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255], ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);

/** The MP4 file for these H.264 samples (AVCC, as VideoEncoder gives them with format "avc"); `avcC` is the encoder's decoder description. */
export function muxMp4(samples: Sample[], avcC: Uint8Array, width: number, height: number, fps: number): Blob {
  const timescale = 90000, delta = Math.round(timescale / fps), n = samples.length;
  const durationMs = Math.round((n / fps) * 1000), mediaDuration = n * delta;
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isomiso2avc1mp41'));
  const moovFor = (dataOffset: number) => {
    const avc1 = box('avc1',
      [0, 0, 0, 0, 0, 0], u16(1), // reserved, data reference
      new Array(16).fill(0), u16(width), u16(height),
      u32(0x00480000), u32(0x00480000), u32(0), u16(1), // 72 dpi, one frame per sample
      new Array(32).fill(0), u16(0x18), u16(0xffff),
      box('avcC', avcC));
    const stbl = box('stbl',
      full('stsd', 0, 0, u32(1), avc1),
      full('stts', 0, 0, u32(1), u32(n), u32(delta)),
      full('stss', 0, 0, u32(samples.filter((s) => s.key).length), samples.flatMap((s, i) => (s.key ? u32(i + 1) : []))),
      full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
      full('stsz', 0, 0, u32(0), u32(n), samples.flatMap((s) => u32(s.data.length))),
      full('stco', 0, 0, u32(1), u32(dataOffset)));
    const minf = box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
    const mdia = box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(mediaDuration), u16(0x55c4), u16(0)), // language: und
      full('hdlr', 0, 0, u32(0), ascii('vide'), u32(0), u32(0), u32(0), ascii('Novira video\0')),
      minf);
    const trak = box('trak', full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durationMs), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)), mdia);
    return box('moov', full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durationMs), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Array(24).fill(0), u32(2)), trak);
  };
  const moovSize = moovFor(0).length; // the offset's value doesn't change the index's size
  const dataOffset = ftyp.length + moovSize + 8;
  const total = samples.reduce((s, x) => s + x.data.length, 0);
  const mdatHead = new Uint8Array([...u32(total + 8), ...ascii('mdat')]);
  return new Blob([ftyp as BlobPart, moovFor(dataOffset) as BlobPart, mdatHead as BlobPart, ...samples.map((s) => s.data as BlobPart)], { type: 'video/mp4' });
}
