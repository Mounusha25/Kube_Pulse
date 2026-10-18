import fs from "node:fs";

const EPSILON = 1e-6;

function validateFeature(name, feature) {
  if (!Array.isArray(feature?.upper_bounds) || !Array.isArray(feature?.expected_proportions)) {
    throw new Error(`Drift reference feature ${name} is malformed`);
  }
  if (feature.upper_bounds.length !== feature.expected_proportions.length) {
    throw new Error(`Drift reference feature ${name} has mismatched bins`);
  }
  const sum = feature.expected_proportions.reduce((total, value) => total + Number(value), 0);
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-6) {
    throw new Error(`Drift reference feature ${name} proportions must sum to one`);
  }
}

export function loadDriftReference(path) {
  const reference = JSON.parse(fs.readFileSync(path, "utf8"));
  if (reference?.schema_version !== "1.0") throw new Error("Unsupported drift reference schema");
  validateFeature("memory_ratio", reference?.features?.memory_ratio);
  validateFeature("predicted_memory_ratio", reference?.features?.predicted_memory_ratio);
  const thresholds = reference?.monitoring?.thresholds;
  if (
    !Number.isFinite(thresholds?.memory_ratio)
    || thresholds.memory_ratio <= 0
    || !Number.isFinite(thresholds?.predicted_memory_ratio)
    || thresholds.predicted_memory_ratio <= 0
  ) {
    throw new Error("Drift reference calibrated thresholds are missing or invalid");
  }
  return reference;
}

export function populationStabilityIndex(samples, feature) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error("PSI samples must be non-empty");
  const counts = new Array(feature.upper_bounds.length).fill(0);
  for (const raw of samples) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("PSI samples must be finite");
    const index = feature.upper_bounds.findIndex((upper) => upper === null || value < Number(upper));
    counts[index === -1 ? counts.length - 1 : index] += 1;
  }
  return counts.reduce((psi, count, index) => {
    const actual = Math.max(count / samples.length, EPSILON);
    const expected = Math.max(Number(feature.expected_proportions[index]), EPSILON);
    return psi + ((actual - expected) * Math.log(actual / expected));
  }, 0);
}

export class DriftDetector {
  constructor({ reference, windowSize = 120, minimumSamples = 60, threshold = 0.2, consecutiveWindows = 3 }) {
    if (minimumSamples > windowSize) throw new Error("Drift minimum samples cannot exceed window size");
    const thresholds = typeof threshold === "number"
      ? { memory_ratio: threshold, predicted_memory_ratio: threshold }
      : threshold;
    if (!thresholds || !Number.isFinite(thresholds.memory_ratio) || !Number.isFinite(thresholds.predicted_memory_ratio)) {
      throw new Error("Drift thresholds are missing or invalid");
    }
    Object.assign(this, { reference, windowSize, minimumSamples, thresholds, consecutiveWindows });
    this.inputSamples = [];
    this.predictionSamples = [];
    this.consecutiveDrift = 0;
    this.detected = false;
  }

  append(samples, value) {
    samples.push(Number(value));
    if (samples.length > this.windowSize) samples.shift();
  }

  observeInput(value) {
    this.append(this.inputSamples, value);
  }

  observePrediction(value) {
    this.append(this.predictionSamples, value);
    if (this.inputSamples.length < this.minimumSamples || this.predictionSamples.length < this.minimumSamples) {
      return this.status();
    }
    const inputPsi = populationStabilityIndex(
      this.inputSamples,
      this.reference.features.memory_ratio,
    );
    const predictionPsi = populationStabilityIndex(
      this.predictionSamples,
      this.reference.features.predicted_memory_ratio,
    );
    if (
      inputPsi >= this.thresholds.memory_ratio
      || predictionPsi >= this.thresholds.predicted_memory_ratio
    ) this.consecutiveDrift += 1;
    else this.consecutiveDrift = 0;
    this.detected = this.consecutiveDrift >= this.consecutiveWindows;
    return this.status(inputPsi, predictionPsi);
  }

  status(inputPsi = 0, predictionPsi = 0) {
    const ready = this.inputSamples.length >= this.minimumSamples && this.predictionSamples.length >= this.minimumSamples;
    return {
      driftReady: Number(ready),
      inputDriftPsi: inputPsi,
      predictionDriftPsi: predictionPsi,
      driftDetected: Number(this.detected),
      retrainingRecommended: Number(this.detected),
      driftWindowSamples: Math.min(this.inputSamples.length, this.predictionSamples.length),
    };
  }
}
