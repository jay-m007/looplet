import { GifWriter, makePalette, makeIndexer, fitSize, frameTimes, sequence, delayCs, fmtBytes, MAX_SECONDS } from "./engine/index.js";

const $ = (id) => document.getElementById(id);
const FPS = 15, CAP_SIDE = 480;
const view = $("view"), vctx = view.getContext("2d", { willReadFrequently: true });
let frames = [];                 // ImageData captured at <= 480 px
let size = { width: 480, height: 360 };
let source = null;               // {kind:"file", video, url, duration} | {kind:"camera"}
let playing = true, raf = 0, t0 = 0, resultUrl = null, resultBytes = null, busy = false, stream = null, recTimer = 0;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reduced) playing = false;

const say = (msg, err = false) => { const s = $("status"); s.textContent = msg; s.className = "status" + (err ? " err" : ""); };
const tick = () => new Promise((r) => setTimeout(r, 0));
const setBusy = (b) => { busy = b; for (const id of ["rec", "make", "start", "speed", "mode", "size"]) $(id).disabled = b; $("file").disabled = b; };

/* ---------- preview ---------- */
function order() { return sequence(frames.length, $("mode").value); }
function loop(ts) {
  raf = requestAnimationFrame(loop);
  if (!frames.length || !playing) return;
  const ord = order(), per = delayCs(FPS, +$("speed").value) * 10;
  const i = ord[Math.max(0, Math.floor((ts - t0) / per)) % ord.length];
  vctx.putImageData(frames[i], 0, 0);
}
function showFrames(list, sz) {
  frames = list; size = sz; view.width = sz.width; view.height = sz.height;
  $("stage").classList.toggle("has", list.length > 0);
  $("transport").hidden = list.length === 0; $("controls").hidden = list.length === 0;
  t0 = performance.now(); if (list.length) vctx.putImageData(list[0], 0, 0);
  $("meta").textContent = list.length ? `${list.length} frames, ${(list.length / FPS).toFixed(1)} s` : "";
  $("playpause").textContent = playing ? "Pause" : "Play"; $("playpause").setAttribute("aria-pressed", String(!playing));
  clearResult();
}
$("playpause").addEventListener("click", () => { playing = !playing; t0 = performance.now(); $("playpause").textContent = playing ? "Pause" : "Play"; $("playpause").setAttribute("aria-pressed", String(!playing)); });
for (const id of ["speed", "mode"]) $(id).addEventListener("change", () => { t0 = performance.now(); clearResult(); });
$("size").addEventListener("change", clearResult);
raf = requestAnimationFrame(loop);

/* ---------- from a video file ---------- */
function seek(v, t) { return new Promise((res, rej) => { const ok = () => { v.removeEventListener("error", bad); res(); }, bad = () => { v.removeEventListener("seeked", ok); rej(new Error("seek")); }; v.addEventListener("seeked", ok, { once: true }); v.addEventListener("error", bad, { once: true }); v.currentTime = t; }); }
async function readFile(file) {
  if (source && source.url) URL.revokeObjectURL(source.url);
  source = null; setBusy(true); say("Opening the video…");
  const url = URL.createObjectURL(file), v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try {
    await new Promise((res, rej) => { v.addEventListener("loadeddata", res, { once: true }); v.addEventListener("error", () => rej(new Error("decode")), { once: true }); });
    if (!isFinite(v.duration) || !v.videoWidth) throw new Error("decode");
    source = { kind: "file", video: v, url, duration: v.duration };
    const long = v.duration > MAX_SECONDS + 0.2;
    $("start-row").hidden = !long; $("start").max = String(Math.max(0, v.duration - MAX_SECONDS).toFixed(1)); $("start").value = "0"; $("start-out").textContent = "0.0 s";
    await grabFile(0);
    say(long ? `Using ${MAX_SECONDS} seconds of a ${v.duration.toFixed(0)} second video. Slide “Start at” to pick which part.` : "Ready. Adjust it, then make the GIF.");
  } catch (e) {
    URL.revokeObjectURL(url); source = null;
    say("This browser could not read that video. MP4 (H.264) and WebM files usually work; try another file.", true);
  }
  setBusy(false);
}
async function grabFile(start) {
  const v = source.video, sz = fitSize(v.videoWidth, v.videoHeight, CAP_SIDE), cv = document.createElement("canvas");
  cv.width = sz.width; cv.height = sz.height; const c = cv.getContext("2d", { willReadFrequently: true });
  const times = frameTimes(v.duration, FPS, { start }), out = [];
  for (let i = 0; i < times.length; i++) {
    await seek(v, times[i]); c.drawImage(v, 0, 0, sz.width, sz.height); out.push(c.getImageData(0, 0, sz.width, sz.height));
    if (i % 6 === 0) { say(`Reading frames ${i + 1} of ${times.length}…`); await tick(); }
  }
  showFrames(out, sz);
}
$("file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) { stopCamera(); readFile(f); } });
$("start").addEventListener("input", () => { $("start-out").textContent = (+$("start").value).toFixed(1) + " s"; });
$("start").addEventListener("change", async () => { if (source && source.kind === "file" && !busy) { setBusy(true); try { await grabFile(+$("start").value); say("Ready."); } catch { say("Could not read that part of the video.", true); } setBusy(false); } });

/* ---------- from the camera ---------- */
function stopCamera() { clearInterval(recTimer); if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; } $("stop").hidden = true; $("rec").hidden = false; $("overlay").textContent = ""; $("overlay").className = "overlay"; }
let cancelRec = false, wasPlaying = true;
$("stop").addEventListener("click", () => { cancelRec = true; });
$("rec").addEventListener("click", async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say("This page cannot reach a camera here. Camera needs a secure page (https or localhost) and a browser that supports it. You can still choose a video file.", true); return; }
  setBusy(true); cancelRec = false; wasPlaying = playing; clearResult();
  const v = document.createElement("video"); v.muted = true; v.playsInline = true;
  try {
    say("Asking for the camera…");
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false });
    v.srcObject = stream; await v.play();
    await new Promise((r) => (v.videoWidth ? r() : v.addEventListener("loadedmetadata", r, { once: true })));
    const sz = fitSize(v.videoWidth, v.videoHeight, CAP_SIDE); view.width = sz.width; view.height = sz.height; $("stage").classList.add("has"); playing = false;
    const draw = () => vctx.drawImage(v, 0, 0, sz.width, sz.height);
    const live = setInterval(draw, 1000 / 30);
    $("rec").hidden = true; $("stop").hidden = false; $("stop").disabled = false;
    say("Get ready. Recording starts after the countdown.");
    for (let n = 3; n >= 1 && !cancelRec; n--) { $("overlay").className = "overlay"; $("overlay").textContent = String(n); await new Promise((r) => setTimeout(r, 800)); }
    $("overlay").className = "overlay rec"; $("overlay").textContent = "REC";
    const out = [], start = performance.now(); say("Recording. Press Stop to finish early.");
    await new Promise((resolve) => {
      let next = 0;
      recTimer = setInterval(() => {
        const el = performance.now() - start;
        if (el >= next) { draw(); out.push(vctx.getImageData(0, 0, sz.width, sz.height)); next += 1000 / FPS; }
        if (cancelRec || out.length >= MAX_SECONDS * FPS) { clearInterval(recTimer); resolve(); }
      }, 1000 / 60);
    });
    clearInterval(live); stopCamera();
    if (out.length < 3) { playing = wasPlaying; say("That was too short. Record at least a second.", true); if (frames.length) showFrames(frames, size); else { $("stage").classList.remove("has"); view.width = 480; view.height = 360; } }
    else { playing = !reduced; showFrames(out, sz); say("Ready. Adjust it, then make the GIF."); }
    source = { kind: "camera" }; $("start-row").hidden = true;
  } catch (e) {
    stopCamera(); playing = wasPlaying; if (!frames.length) $("stage").classList.remove("has");
    say(e && e.name === "NotAllowedError" ? "Camera permission was blocked. Allow it in the browser’s site settings, or choose a video file instead." : e && e.name === "NotFoundError" ? "No camera found. Choose a video file instead." : "The camera could not start. Choose a video file instead.", true);
  }
  setBusy(false);
});

/* ---------- make the GIF ---------- */
function clearResult() { $("result").hidden = true; if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; } $("gif").removeAttribute("src"); resultBytes = null; }
$("make").addEventListener("click", async () => {
  if (!frames.length || busy) return;
  setBusy(true); clearResult();
  try {
    const target = fitSize(size.width, size.height, +$("size").value), cv = document.createElement("canvas"), src = document.createElement("canvas");
    cv.width = target.width; cv.height = target.height; src.width = size.width; src.height = size.height;
    const c = cv.getContext("2d", { willReadFrequently: true }), sc = src.getContext("2d");
    c.imageSmoothingQuality = "high";
    const small = [];
    for (let i = 0; i < frames.length; i++) { sc.putImageData(frames[i], 0, 0); c.drawImage(src, 0, 0, target.width, target.height); small.push(c.getImageData(0, 0, target.width, target.height)); if (i % 10 === 0) await tick(); }
    say("Choosing colours…"); await tick();
    const pal = makePalette(small.map((f) => f.data)), idx = makeIndexer(pal), gif = new GifWriter(target.width, target.height, pal, 0);
    const delay = delayCs(FPS, +$("speed").value), ord = sequence(small.length, $("mode").value);
    const cache = new Map();
    for (let k = 0; k < ord.length; k++) {
      const i = ord[k]; if (!cache.has(i)) cache.set(i, idx(small[i].data, target.width, target.height));
      gif.addFrame(cache.get(i), delay);
      if (k % 4 === 0) { say(`Building GIF… ${Math.round(((k + 1) / ord.length) * 100)}%`); await tick(); }
    }
    resultBytes = gif.finish();
    resultUrl = URL.createObjectURL(new Blob([resultBytes], { type: "image/gif" }));
    $("gif").src = resultUrl; $("result").hidden = false;
    const secs = (ord.length * delay) / 100;
    $("gif-info").textContent = `${target.width} × ${target.height}, ${ord.length} frames, ${secs.toFixed(1)} s, ${fmtBytes(resultBytes.length)}.` + (resultBytes.length > 8 * 1048576 ? " This is large for chat apps. Try Small, a faster speed, or a shorter part." : "");
    say("Done.");
    $("result").scrollIntoView({ block: "nearest" });
  } catch (e) { say("Something went wrong making the GIF. Try a smaller size.", true); }
  setBusy(false);
});
$("save").addEventListener("click", () => {
  if (!resultUrl) return;
  const a = document.createElement("a"); a.href = resultUrl; a.download = "looplet.gif"; document.body.append(a); a.click(); a.remove();
});
