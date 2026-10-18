import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryQuery, PrometheusClient } from "../src/prometheus.js";

test("builds an aggregate pod-memory query", () => {
  assert.equal(
    buildMemoryQuery({ namespace: "default", podName: "api", containerName: "web" }),
    'sum(container_memory_usage_bytes{namespace="default",pod="api",container!="",image!="",container="web"})',
  );
});

test("extracts one scalar result", async () => {
  const client = new PrometheusClient({
    httpClient: { get: async () => ({ data: { status: "success", data: { result: [{ value: [123, "42.5"] }] } } }) },
    baseUrl: "http://prometheus.test",
  });
  assert.equal(await client.queryScalar("sum(up)"), 42.5);
});

test("rejects missing and ambiguous results", async () => {
  for (const result of [[], [{ value: [0, "1"] }, { value: [0, "2"] }]]) {
    const client = new PrometheusClient({
      httpClient: { get: async () => ({ data: { status: "success", data: { result } } }) },
      baseUrl: "http://prometheus.test",
    });
    await assert.rejects(() => client.queryScalar("up"), /expected one/);
  }
});
