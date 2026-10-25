// A small GIF writer: median-cut palette, GIF-style LZW, looping. No dependencies.

/** Build one 256-colour palette for all frames. frames: array of RGBA byte arrays. Returns {palette: Uint8Array(768), count}. */
export function makePalette(frames, maxColors = 256) {
  const hist = new Map();
  for (const f of frames) {
    const step = Math.max(1, Math.floor(f.length / 4 / 40000)); // look at about 40,000 pixels per frame
    for (let i = 0; i < f.length; i += 4 * step) {
      const k = ((f[i] >> 3) << 10) | ((f[i + 1] >> 3) << 5) | (f[i + 2] >> 3);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  let boxes = [{ cols: [...hist].map(([k, n]) => ({ r: (k >> 10) & 31, g: (k >> 5) & 31, b: k & 31, n })) }];
  const range = (b) => {
    let r0 = 31, r1 = 0, g0 = 31, g1 = 0, b0 = 31, b1 = 0;
    for (const c of b.cols) { if (c.r < r0) r0 = c.r; if (c.r > r1) r1 = c.r; if (c.g < g0) g0 = c.g; if (c.g > g1) g1 = c.g; if (c.b < b0) b0 = c.b; if (c.b > b1) b1 = c.b; }
    const dr = r1 - r0, dg = g1 - g0, db = b1 - b0;
    b.axis = dr >= dg && dr >= db ? "r" : dg >= db ? "g" : "b"; b.size = Math.max(dr, dg, db);
  };
  boxes.forEach(range);
  while (boxes.length < maxColors) {
    let best = -1, bs = 0;
    boxes.forEach((b, i) => { const s = b.size * Math.log2(2 + b.cols.length); if (b.cols.length > 1 && s > bs) { bs = s; best = i; } });
    if (best < 0) break;
    const b = boxes[best], ax = b.axis;
    b.cols.sort((x, y) => x[ax] - y[ax]);
    let total = 0; for (const c of b.cols) total += c.n;
    let acc = 0, cut = 1;
    for (let i = 0; i < b.cols.length - 1; i++) { acc += b.cols[i].n; cut = i + 1; if (acc * 2 >= total) break; }
    const a = { cols: b.cols.slice(0, cut) }, c = { cols: b.cols.slice(cut) };
    range(a); range(c); boxes.splice(best, 1, a, c);
  }
  const palette = new Uint8Array(768);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const c of b.cols) { r += c.r * c.n; g += c.g * c.n; bl += c.b * c.n; n += c.n; }
    palette[i * 3] = Math.min(255, Math.round((r / n) * 8 + 4)); palette[i * 3 + 1] = Math.min(255, Math.round((g / n) * 8 + 4)); palette[i * 3 + 2] = Math.min(255, Math.round((bl / n) * 8 + 4));
  });
  return { palette, count: boxes.length };
}

/** Turns RGBA pixels into palette indexes. The nearest colour is worked out once per 15-bit colour and remembered. */
export function makeIndexer(pal) {
  const cache = new Int16Array(32768).fill(-1);
  const p = pal.palette, n = pal.count;
  return (rgba, w, h) => {
    const out = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) {
      const k = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
      let v = cache[k];
      if (v < 0) {
        const r = (k >> 10 & 31) * 8 + 4, g = (k >> 5 & 31) * 8 + 4, b = (k & 31) * 8 + 4;
        let best = 0, bd = Infinity;
        for (let c = 0; c < n; c++) { const dr = p[c * 3] - r, dg = p[c * 3 + 1] - g, db = p[c * 3 + 2] - b; const d = dr * dr * 3 + dg * dg * 4 + db * db * 2; if (d < bd) { bd = d; best = c; } }
        cache[k] = v = best;
      }
      out[j] = v;
    }
    return out;
  };
}

function lzw(pixels, out) {
  const MIN = 8, CLEAR = 256, EOI = 257;
  let size = MIN + 1, next = EOI + 1, dict = new Map(), cur = 0, bits = 0;
  const bytes = [];
  const emit = (code) => { cur |= code << bits; bits += size; while (bits >= 8) { bytes.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(CLEAR);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i], key = prefix * 256 + c, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) { emit(CLEAR); next = EOI + 1; size = MIN + 1; dict = new Map(); }
    else { if (next >= (1 << size)) size++; dict.set(key, next++); }
    prefix = c;
  }
  emit(prefix); emit(EOI);
  if (bits > 0) bytes.push(cur & 255);
  out.push(MIN);
  for (let i = 0; i < bytes.length; i += 255) { const n = Math.min(255, bytes.length - i); out.push(n); for (let j = 0; j < n; j++) out.push(bytes[i + j]); }
  out.push(0);
}

export class GifWriter {
  constructor(width, height, pal, loops = 0) {
    this.w = width; this.h = height; this.out = [];
    const o = this.out, le = (v) => o.push(v & 255, (v >> 8) & 255);
    for (const ch of "GIF89a") o.push(ch.charCodeAt(0));
    le(width); le(height); o.push(0xf7, 0, 0);
    for (let i = 0; i < 768; i++) o.push(pal.palette[i]);
    o.push(0x21, 0xff, 0x0b); for (const ch of "NETSCAPE2.0") o.push(ch.charCodeAt(0)); o.push(3, 1); le(loops); o.push(0);
  }
  /** indexes: Uint8Array(w*h) of palette positions; delay in hundredths of a second (at least 2). */
  addFrame(indexes, delay) {
    const o = this.out, le = (v) => o.push(v & 255, (v >> 8) & 255);
    o.push(0x21, 0xf9, 4, 0x04); le(Math.max(2, Math.round(delay))); o.push(0, 0);
    o.push(0x2c); le(0); le(0); le(this.w); le(this.h); o.push(0);
    lzw(indexes, o);
  }
  finish() { this.out.push(0x3b); return Uint8Array.from(this.out); }
}

/** Convenience for tests and small jobs. frames: [{rgba, delay}] */
export function encodeGIF({ width, height, frames, loops = 0 }) {
  const pal = makePalette(frames.map((f) => f.rgba)), idx = makeIndexer(pal), g = new GifWriter(width, height, pal, loops);
  for (const f of frames) g.addFrame(idx(f.rgba, width, height), f.delay);
  return g.finish();
}
