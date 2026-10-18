import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("requires a target pod", () => {
  assert.throws(() => loadConfig({}), /KUBEPULSE_POD_NAME or KUBEPULSE_POD_SELECTOR is required/);
  assert.throws(
    () => loadConfig({ KUBEPULSE_POD_NAME: "api", KUBEPULSE_POD_SELECTOR: "app=api" }),
    /Set only one/,
  );
});

test("supports label-based multi-pod discovery", () => {
  const config = loadConfig({ KUBEPULSE_POD_SELECTOR: "app=checkout" });
  assert.equal(config.podName, null);
  assert.equal(config.podSelector, "app=checkout");
});

test("loads safe defaults and validates timing values", () => {
  const config = loadConfig({ KUBEPULSE_POD_NAME: "api-123" });
  assert.equal(config.namespace, "default");
  assert.equal(config.pollIntervalMs, 1000);
  assert.equal(config.windowSize, 10);
  assert.equal(config.predictionTimeoutMs, 10000);
  assert.equal(config.remediationEnabled, false);
  assert.equal(config.driftEnabled, true);
  assert.equal(config.driftWindowSize, 120);
  assert.equal(config.driftMinimumSamples, 60);
  assert.equal(config.driftThreshold, null);
  assert.throws(
    () => loadConfig({ KUBEPULSE_POD_NAME: "api", KUBEPULSE_POLL_INTERVAL_MS: "0" }),
    /positive integer/,
  );
  assert.throws(
    () => loadConfig({
      KUBEPULSE_POD_NAME: "api",
      KUBEPULSE_DRIFT_WINDOW_SIZE: "10",
      KUBEPULSE_DRIFT_MIN_SAMPLES: "11",
    }),
    /cannot exceed/,
  );
});

test("uses the in-cluster API and enables remediation only when explicitly requested", () => {
  const config = loadConfig({
    KUBEPULSE_POD_NAME: "api",
    KUBERNETES_SERVICE_HOST: "10.96.0.1",
    KUBERNETES_SERVICE_PORT: "443",
    KUBEPULSE_REMEDIATION_ENABLED: "true",
  });
  assert.equal(config.kubernetesApiUrl, "https://10.96.0.1:443");
  assert.equal(config.remediationEnabled, true);
});
