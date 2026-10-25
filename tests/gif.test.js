import test from "node:test";
import assert from "node:assert/strict";
import { encodeGIF, makePalette, makeIndexer, GifWriter } from "../engine/gif.js";

// A tiny independent GIF reader, written from the spec, so the encoder is checked against something that did not share its code.
function decodeGIF(u8) {
  let p = 0; const rd = () => u8[p++], le = () => { const v = u8[p] | (u8[p + 1] << 8); p += 2; return v; };
  assert.equal(String.fromCharCode(...u8.slice(0, 6)), "GIF89a"); p = 6;
  const width = le(), height = le(), packed = rd(); rd(); rd();
  const gct = packed & 0x80 ? u8.slice(p, (p += 3 * (1 << ((packed & 7) + 1)))) : null;
  const frames = []; let delay = 0, loops = null;
  for (;;) {
    const b = rd();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = rd();
      if (label === 0xf9) { rd(); rd(); delay = le(); rd(); rd(); }
      else if (label === 0xff) { const n = rd(); const name = String.fromCharCode(...u8.slice(p, p + n)); p += n; for (let s = rd(); s; s = rd()) { if (name === "NETSCAPE2.0") loops = u8[p + 1] | (u8[p + 2] << 8); p += s; } }
      else for (let s = rd(); s; s = rd()) p += s;
    } else if (b === 0x2c) {
      le(); le(); const w = le(), h = le(); rd();
      const min = rd(); const data = [];
      for (let s = rd(); s; s = rd()) { for (let i = 0; i < s; i++) data.push(u8[p + i]); p += s; }
      const pix = lzwDecode(min, data, w * h);
      frames.push({ w, h, delay, pix });
    } else throw new Error("bad block " + b);
  }
  return { width, height, gct, frames, loops };
}
function lzwDecode(min, data, n) {
  const clear = 1 << min, eoi = clear + 1; let size = min + 1, next = eoi + 1, bits = 0, cur = 0, di = 0;
  let table = []; const reset = () => { table = []; for (let i = 0; i < clear; i++) table[i] = [i]; table[clear] = []; table[eoi] = []; size = min + 1; next = eoi + 1; };
  reset(); const out = []; let prev = null;
  for (;;) {
    while (bits < size) { if (di >= data.length) return out; cur |= data[di++] << bits; bits += 8; }
    const code = cur & ((1 << size) - 1); cur >>>= size; bits -= size;
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry;
    if (table[code]) entry = table[code]; else if (code === next && prev) entry = [...prev, prev[0]]; else throw new Error("bad code " + code);
    for (const v of entry) out.push(v);
    if (prev && next < 4096) { table[next++] = [...prev, entry[0]]; if (next === (1 << size) && size < 12) size++; }
    prev = entry;
  }
  return out;
}
const solid = (w, h, r, g, b) => { const a = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < a.length; i += 4) { a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255; } return a; };
const noise = (w, h, seed) => { let s = seed; const a = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < a.length; i += 4) { for (let c = 0; c < 3; c++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i + c] = (s >> 8) & 255; } a[i + 3] = 255; } return a; };
const colourOf = (g, f, i) => { const k = g.frames[f].pix[i]; return [g.gct[k * 3], g.gct[k * 3 + 1], g.gct[k * 3 + 2]]; };
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test("header, size, loop forever and frame delays are written as asked", () => {
  const g = decodeGIF(encodeGIF({ width: 4, height: 3, frames: [{ rgba: solid(4, 3, 255, 0, 0), delay: 7 }, { rgba: solid(4, 3, 0, 0, 255), delay: 12 }] }));
  assert.equal(g.width, 4); assert.equal(g.height, 3); assert.equal(g.loops, 0); assert.equal(g.frames.length, 2);
  assert.deepEqual(g.frames.map((f) => f.delay), [7, 12]);
});
test("delays below 2 are raised to 2", () => {
  const g = decodeGIF(encodeGIF({ width: 2, height: 2, frames: [{ rgba: solid(2, 2, 1, 2, 3), delay: 0 }] }));
  assert.equal(g.frames[0].delay, 2);
});
test("flat colours come back close to the original", () => {
  const g = decodeGIF(encodeGIF({ width: 5, height: 5, frames: [{ rgba: solid(5, 5, 250, 20, 20), delay: 5 }, { rgba: solid(5, 5, 20, 20, 250), delay: 5 }] }));
  assert.ok(near(colourOf(g, 0, 12), [250, 20, 20], 8), String(colourOf(g, 0, 12)));
  assert.ok(near(colourOf(g, 1, 3), [20, 20, 250], 8));
});
test("a gradient round trips pixel for pixel in position and within a small colour error", () => {
  const w = 64, h = 32, a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; a[i] = x * 4; a[i + 1] = y * 8; a[i + 2] = 128; a[i + 3] = 255; }
  const g = decodeGIF(encodeGIF({ width: w, height: h, frames: [{ rgba: a, delay: 5 }] }));
  let worst = 0; for (let j = 0; j < w * h; j++) { const c = colourOf(g, 0, j); for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(c[k] - a[j * 4 + k])); }
  assert.ok(worst <= 24, "worst channel error " + worst);
});
test("noise forces the code table to fill and reset several times, and every pixel index survives", () => {
  const w = 200, h = 120, a = noise(w, h, 7), pal = makePalette([a]), idx = makeIndexer(pal)(a, w, h);
  const wr = new GifWriter(w, h, pal); wr.addFrame(idx, 4);
  const g = decodeGIF(wr.finish());
  assert.equal(g.frames[0].pix.length, w * h); assert.deepEqual(Uint8Array.from(g.frames[0].pix), idx);
});
test("a one pixel image and a long run of one colour both work", () => {
  assert.equal(decodeGIF(encodeGIF({ width: 1, height: 1, frames: [{ rgba: solid(1, 1, 9, 9, 9), delay: 3 }] })).frames[0].pix.length, 1);
  const g = decodeGIF(encodeGIF({ width: 300, height: 300, frames: [{ rgba: solid(300, 300, 0, 255, 0), delay: 3 }] }));
  assert.equal(g.frames[0].pix.length, 90000); assert.ok(new Set(g.frames[0].pix).size === 1);
});
test("many frames share one palette", () => {
  const frames = Array.from({ length: 12 }, (_, i) => ({ rgba: solid(8, 8, i * 20, 255 - i * 20, 100), delay: 5 }));
  const g = decodeGIF(encodeGIF({ width: 8, height: 8, frames }));
  assert.equal(g.frames.length, 12); assert.ok(near(colourOf(g, 11, 0), [220, 35, 100], 10));
});
test("palette never has more than 256 colours and works with just two", () => {
  assert.ok(makePalette([noise(100, 100, 3)]).count <= 256);
  const two = makePalette([solid(4, 4, 255, 255, 255), solid(4, 4, 0, 0, 0)]); assert.equal(two.count, 2);
});
test("output is far smaller than raw for flat images", () => {
  const gif = encodeGIF({ width: 200, height: 200, frames: [{ rgba: solid(200, 200, 40, 40, 200), delay: 5 }] });
  assert.ok(gif.length < 2000, "size " + gif.length);
});
