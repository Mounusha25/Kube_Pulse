import test from "node:test";
import assert from "node:assert/strict";

import { MultiPodMonitor } from "../src/monitor.js";

function pod(name, memory = "100") {
  return { metadata: { name }, spec: { containers: [{ resources: { limits: { memory } } }] } };
}

function createHarness(pods) {
  const queries = [];
  const reports = [];
  const logs = [];
  const kubernetes = {
    listPods: async () => pods.value,
    getMemoryLimitBytesFromPod: (item) => Number(item.spec.containers[0].resources.limits.memory),
    isCrashLooping: async () => false,
  };
  const monitor = new MultiPodMonitor({
    kubernetes,
    prometheus: { queryScalar: async (query) => { queries.push(query); return query.includes('pod="api-0"') ? 50 : 75; } },
    engine: { predict: async ({ podName, memoryUsage }) => ({ predictedMemory: memoryUsage.at(-1), isAnomaly: 0, podName }) },
    reporter: async (payload) => reports.push(payload),
    suggestCommand: async () => "unused",
    namespace: "shop",
    windowSize: 2,
    logger: { log: (message) => logs.push(message), warn: () => {}, error: () => {} },
  });
  return { monitor, queries, reports, logs };
}

test("maintains independent windows and reports a metric for each pod", async () => {
  const pods = { value: [pod("api-0"), pod("api-1")] };
  const { monitor, queries, reports } = createHarness(pods);
  await monitor.poll();
  await monitor.poll();
  assert.equal(monitor.states.get("api-0").window.at(-1), 0.5);
  assert.equal(monitor.states.get("api-1").window.at(-1), 0.75);
  assert.equal(queries.length, 4);
  assert.deepEqual(reports.map((item) => [item.podName, item.predictedMemory]), [
    ["api-0", 0.5],
    ["api-1", 0.75],
  ]);
});

test("adds newly discovered pods and removes stale pod state", async () => {
  const pods = { value: [pod("api-0")] };
  const { monitor } = createHarness(pods);
  await monitor.poll();
  pods.value = [pod("api-1")];
  await monitor.poll();
  assert.deepEqual([...monitor.states.keys()], ["api-1"]);
  assert.equal(monitor.states.get("api-1").window.length, 1);
});

test("isolates a failed pod so other pods are still processed", async () => {
  const pods = { value: [pod("api-0"), pod("api-1")] };
  const errors = [];
  const monitor = new MultiPodMonitor({
    kubernetes: {
      listPods: async () => pods.value,
      getMemoryLimitBytesFromPod: () => 100,
      isCrashLooping: async () => false,
    },
    prometheus: { queryScalar: async (query) => {
      if (query.includes('pod="api-0"')) throw new Error("missing series");
      return 50;
    } },
    engine: { predict: async () => ({ predictedMemory: 0.5, isAnomaly: 0 }) },
    reporter: async () => {},
    suggestCommand: async () => "unused",
    namespace: "shop",
    windowSize: 1,
    logger: { log: () => {}, warn: () => {}, error: (message) => errors.push(message) },
  });
  await monitor.poll();
  assert.match(errors[0], /api-0 poll failed: missing series/);
  assert.equal(monitor.states.get("api-1").window.length, 1);
});

test("skips a pod with invalid resources without blocking valid targets", async () => {
  const pods = { value: [pod("bad", "missing"), pod("api-1")] };
  const { monitor } = createHarness(pods);
  monitor.kubernetes.getMemoryLimitBytesFromPod = (item) => {
    if (item.metadata.name === "bad") throw new Error("memory limit is missing");
    return 100;
  };
  await monitor.poll();
  assert.deepEqual([...monitor.states.keys()], ["api-1"]);
});

test("exports sustained per-pod drift status with predictions", async () => {
  const reports = [];
  const reference = {
    features: {
      memory_ratio: { upper_bounds: [0.5, null], expected_proportions: [0.5, 0.5] },
      predicted_memory_ratio: { upper_bounds: [0.5, null], expected_proportions: [0.5, 0.5] },
    },
  };
  const monitor = new MultiPodMonitor({
    kubernetes: {
      listPods: async () => [pod("api-0")],
      getMemoryLimitBytesFromPod: () => 100,
      isCrashLooping: async () => false,
    },
    prometheus: { queryScalar: async () => 90 },
    engine: { predict: async () => ({ predictedMemory: 0.9, isAnomaly: 0 }) },
    reporter: async (payload) => reports.push(payload),
    suggestCommand: async () => "unused",
    namespace: "shop",
    windowSize: 1,
    driftReference: reference,
    driftWindowSize: 2,
    driftMinimumSamples: 2,
    driftThreshold: 0.2,
    driftConsecutiveWindows: 1,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });
  await monitor.poll();
  await monitor.poll();
  assert.equal(reports.at(-1).driftReady, 1);
  assert.equal(reports.at(-1).driftDetected, 1);
  assert.equal(reports.at(-1).retrainingRecommended, 1);
  assert.equal(reports.at(-1).driftWindowSamples, 2);
});
