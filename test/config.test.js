import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("requires a target pod", () => {
  assert.throws(() => loadConfig({}), /KUBEPULSE_POD_NAME is required/);
});

test("loads safe defaults and validates timing values", () => {
  const config = loadConfig({ KUBEPULSE_POD_NAME: "api-123" });
  assert.equal(config.namespace, "default");
  assert.equal(config.pollIntervalMs, 1000);
  assert.equal(config.windowSize, 10);
  assert.equal(config.predictionTimeoutMs, 10000);
  assert.equal(config.remediationEnabled, false);
  assert.throws(
    () => loadConfig({ KUBEPULSE_POD_NAME: "api", KUBEPULSE_POLL_INTERVAL_MS: "0" }),
    /positive integer/,
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
