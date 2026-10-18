import test from "node:test";
import assert from "node:assert/strict";
import { KubernetesClient, parseMemoryQuantityToBytes } from "../src/kubernetes.js";

test("parses Kubernetes memory quantities", () => {
  assert.equal(parseMemoryQuantityToBytes("512Mi"), 512 * 2 ** 20);
  assert.equal(parseMemoryQuantityToBytes("1Gi"), 2 ** 30);
  assert.equal(parseMemoryQuantityToBytes("500M"), 500_000_000);
  assert.equal(parseMemoryQuantityToBytes("1024Ki"), 1024 * 2 ** 10);
  assert.equal(parseMemoryQuantityToBytes("4096"), 4096);
});

test("rejects invalid memory quantities", () => {
  assert.throws(() => parseMemoryQuantityToBytes(undefined), /missing/);
  assert.throws(() => parseMemoryQuantityToBytes("1GB"), /Unsupported/);
  assert.throws(() => parseMemoryQuantityToBytes("0Mi"), /positive/);
});

test("selects a container and detects CrashLoopBackOff", async () => {
  const pod = {
    spec: { containers: [
      { name: "sidecar", resources: { limits: { memory: "64Mi" } } },
      { name: "app", resources: { limits: { memory: "512Mi" } } },
    ] },
    status: { containerStatuses: [
      { name: "sidecar", state: { running: {} } },
      { name: "app", state: { waiting: { reason: "CrashLoopBackOff" } } },
    ] },
  };
  const client = new KubernetesClient({
    httpClient: { get: async () => ({ data: pod }) },
    baseUrl: "http://kube.test", namespace: "default", podName: "demo", containerName: "app",
  });
  assert.equal(await client.getMemoryLimitBytes(), 512 * 2 ** 20);
  assert.equal(await client.isCrashLooping(), true);
});
