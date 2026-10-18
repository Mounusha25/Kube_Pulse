import test from "node:test";
import assert from "node:assert/strict";

import { DriftDetector, loadDriftReference, populationStabilityIndex } from "../src/drift-detector.js";

const feature = { upper_bounds: [0.5, null], expected_proportions: [0.5, 0.5] };
const reference = {
  schema_version: "1.0",
  features: { memory_ratio: feature, predicted_memory_ratio: feature },
  monitoring: { thresholds: { memory_ratio: 0.2, predicted_memory_ratio: 0.2 } },
};

test("loads the versioned calibrated drift reference", () => {
  const artifact = loadDriftReference(new URL("../models/v2/drift_reference.json", import.meta.url));
  assert.equal(artifact.model_version, "v2");
  assert.equal(artifact.dataset.sha256.length, 64);
  assert.ok(artifact.monitoring.thresholds.memory_ratio > 0.2);
  assert.ok(artifact.monitoring.thresholds.predicted_memory_ratio > 0.2);
});

test("PSI is zero for a matching distribution and high for a shifted distribution", () => {
  assert.equal(populationStabilityIndex([0.1, 0.2, 0.7, 0.8], feature), 0);
  assert.ok(populationStabilityIndex([0.7, 0.8, 0.9, 1.0], feature) > 1);
});

test("drift requires enough samples and consecutive shifted windows", () => {
  const detector = new DriftDetector({
    reference,
    windowSize: 4,
    minimumSamples: 4,
    threshold: 0.2,
    consecutiveWindows: 2,
  });
  let status;
  for (let index = 0; index < 5; index += 1) {
    detector.observeInput(0.9);
    status = detector.observePrediction(0.9);
  }
  assert.equal(status.driftReady, 1);
  assert.equal(status.driftDetected, 1);
  assert.equal(status.retrainingRecommended, 1);
  assert.equal(status.driftWindowSamples, 4);
});

test("drift clears after consecutive healthy windows", () => {
  const detector = new DriftDetector({
    reference,
    windowSize: 4,
    minimumSamples: 4,
    threshold: 0.2,
    consecutiveWindows: 1,
  });
  for (let index = 0; index < 4; index += 1) {
    detector.observeInput(0.9);
    detector.observePrediction(0.9);
  }
  assert.equal(detector.detected, true);
  for (const value of [0.1, 0.8, 0.2, 0.7]) {
    detector.observeInput(value);
    detector.observePrediction(value);
  }
  assert.equal(detector.detected, false);
});
