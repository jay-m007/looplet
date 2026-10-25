import test from "node:test";
import assert from "node:assert/strict";
import { fitSize, frameTimes, sequence, delayCs, fmtBytes, MAX_SECONDS } from "../engine/frames.js";

test("fitSize shrinks the long edge, keeps the shape, never enlarges", () => {
  assert.deepEqual(fitSize(1920, 1080, 480), { width: 480, height: 270 });
  assert.deepEqual(fitSize(1080, 1920, 480), { width: 270, height: 480 });
  assert.deepEqual(fitSize(200, 100, 480), { width: 200, height: 100 });
  assert.deepEqual(fitSize(1000, 1, 100), { width: 100, height: 2 });
});
test("frameTimes: at most 6 seconds, evenly spaced, inside the video", () => {
  const t = frameTimes(30, 10); assert.equal(t.length, 60); assert.equal(t[0], 0); assert.ok(Math.abs(t[59] - 5.9) < 1e-9); assert.equal(MAX_SECONDS, 6);
  assert.equal(frameTimes(2, 10).length, 20);
  assert.ok(frameTimes(2, 10).every((x) => x < 2));
});
test("frameTimes with a start point, near the end, and bad input", () => {
  const t = frameTimes(10, 10, { start: 8 }); assert.equal(t.length, 20); assert.ok(t[19] < 10); assert.equal(t[0], 8);
  assert.equal(frameTimes(10, 10, { start: 50 }).length >= 1, true);
  assert.deepEqual(frameTimes(0, 10), []); assert.deepEqual(frameTimes(5, 0), []); assert.deepEqual(frameTimes(NaN, 10), []);
  assert.equal(frameTimes(0.05, 10).length, 1);
});
test("sequence: forward and ping-pong without repeating the end frames", () => {
  assert.deepEqual(sequence(4), [0, 1, 2, 3]);
  assert.deepEqual(sequence(4, "pingpong"), [0, 1, 2, 3, 2, 1]);
  assert.deepEqual(sequence(2, "pingpong"), [0, 1]); assert.deepEqual(sequence(1, "pingpong"), [0]); assert.deepEqual(sequence(0), []);
});
test("delays follow fps and speed and never go under 2", () => {
  assert.equal(delayCs(10, 1), 10); assert.equal(delayCs(10, 2), 5); assert.equal(delayCs(10, 0.5), 20); assert.equal(delayCs(50, 4), 2); assert.equal(delayCs(15, 1), 7);
});
test("byte sizes read plainly", () => { assert.equal(fmtBytes(900), "900 B"); assert.equal(fmtBytes(2048), "2 KB"); assert.equal(fmtBytes(3 * 1048576), "3.0 MB"); });
