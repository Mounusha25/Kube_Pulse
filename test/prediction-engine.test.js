import test from "node:test";
import assert from "node:assert/strict";
import { parsePredictionLine } from "../src/prediction-engine.js";

test("parses structured prediction output", () => {
  assert.deepEqual(parsePredictionLine('{"predictedMemory":0.91,"isAnomaly":0}'), { predictedMemory: 0.91, isAnomaly: 0 });
});

test("rejects malformed prediction output", () => {
  assert.throws(() => parsePredictionLine("0.91,0"), /invalid JSON/);
  assert.throws(() => parsePredictionLine('{"predictedMemory":"bad","isAnomaly":3}'), /invalid prediction/);
});
