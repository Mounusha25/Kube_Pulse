import test from "node:test";
import assert from "node:assert/strict";
import { routePrediction } from "../src/remediation.js";

const base = {
  podName: "api-123",
  memoryLimitBytes: 512 * 2 ** 20,
  suggestCommand: async () => "kubectl set resources deployment/api --limits=memory=768Mi",
};

test("healthy predictions do not call Kubernetes or the LLM", async () => {
  const result = await routePrediction({
    ...base,
    prediction: { predictedMemory: 0.7, isAnomaly: 0 },
    isCrashLooping: async () => assert.fail("should not be called"),
    suggestCommand: async () => assert.fail("should not be called"),
  });
  assert.deepEqual(result, { outcome: "healthy", command: null });
});

test("CrashLoopBackOff anomalies are escalated", async () => {
  const result = await routePrediction({
    ...base,
    prediction: { predictedMemory: 1.2, isAnomaly: 1 },
    isCrashLooping: async () => true,
    suggestCommand: async () => assert.fail("should not be called"),
  });
  assert.deepEqual(result, { outcome: "escalated", command: null });
});

test("recoverable anomalies produce a non-executed suggestion", async () => {
  const result = await routePrediction({
    ...base,
    prediction: { predictedMemory: 1.2, isAnomaly: 1 },
    isCrashLooping: async () => false,
  });
  assert.equal(result.outcome, "suggested");
  assert.match(result.command, /^kubectl set resources/);
});
