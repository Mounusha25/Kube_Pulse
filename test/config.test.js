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
  assert.throws(
    () => loadConfig({ KUBEPULSE_POD_NAME: "api", KUBEPULSE_POLL_INTERVAL_MS: "0" }),
    /positive integer/,
  );
});
