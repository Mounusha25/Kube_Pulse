import axios from "axios";

import { loadConfig } from "./src/config.js";
import { suggestCommandWithGemini } from "./src/gemini.js";
import { createKubernetesHttpClient } from "./src/http.js";
import { KubernetesClient } from "./src/kubernetes.js";
import { MultiPodMonitor } from "./src/monitor.js";
import { PrometheusClient } from "./src/prometheus.js";
import { PredictionEngine } from "./src/prediction-engine.js";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function suggestCommand({ podName, predictedMemory, memoryLimitBytes }) {
  return suggestCommandWithGemini({
    httpClient: axios,
    env: process.env,
    podName,
    predictedMemory,
    memoryLimitBytes,
  });
}

async function main() {
  const config = loadConfig();
  const kubernetesHttpClient = createKubernetesHttpClient(axios, config);
  const kubernetes = new KubernetesClient({
    httpClient: kubernetesHttpClient,
    baseUrl: config.kubernetesApiUrl,
    namespace: config.namespace,
    podName: config.podName,
    podSelector: config.podSelector,
    containerName: config.containerName,
    timeoutMs: config.requestTimeoutMs,
  });
  const prometheus = new PrometheusClient({ httpClient: axios, baseUrl: config.prometheusUrl, timeoutMs: config.requestTimeoutMs });
  const engine = new PredictionEngine({ pythonBin: config.pythonBin, scriptPath: config.modelScript, cwd: config.projectRoot });
  const monitor = new MultiPodMonitor({
    kubernetes,
    prometheus,
    engine,
    reporter: (payload) => axios.post(config.exporterUrl, payload, { timeout: config.requestTimeoutMs }),
    suggestCommand,
    namespace: config.namespace,
    containerName: config.containerName,
    windowSize: config.windowSize,
    predictionTimeoutMs: config.predictionTimeoutMs,
    remediationEnabled: config.remediationEnabled,
  });
  let stopping = false;

  const stop = () => {
    stopping = true;
    engine.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const target = config.podSelector ? `selector ${config.podSelector}` : `pod ${config.podName}`;
  console.log(`[KubePulse] Monitoring ${config.namespace} ${target} every ${config.pollIntervalMs} ms`);
  while (!stopping) {
    const startedAt = Date.now();
    try {
      const targets = await monitor.poll();
      if (targets === 0) console.warn(`[KubePulse] No pods match ${target}`);
    } catch (error) {
      console.error(`[KubePulse] Poll failed: ${error.message}`);
    }

    const remaining = config.pollIntervalMs - (Date.now() - startedAt);
    if (!stopping && remaining > 0) await sleep(remaining);
  }
}

main().catch((error) => {
  console.error(`[KubePulse] Fatal: ${error.message}`);
  process.exitCode = 1;
});
