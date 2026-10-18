import axios from "axios";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { loadConfig } from "./src/config.js";
import { KubernetesClient } from "./src/kubernetes.js";
import { buildMemoryQuery, PrometheusClient } from "./src/prometheus.js";
import { PredictionEngine } from "./src/prediction-engine.js";
import { routePrediction } from "./src/remediation.js";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function suggestCommand({ podName, predictedMemory, memoryLimitBytes }) {
  const chat = new ChatGoogleGenerativeAI({ model: "gemini-1.5-pro", temperature: 0, maxRetries: 2 });
  const response = await chat.invoke([
    {
      role: "system",
      content: "You are a Kubernetes SRE assistant. Return one suggested kubectl command only. Never execute it.",
    },
    {
      role: "user",
      content: `Pod ${podName} has predicted memory ratio ${predictedMemory.toFixed(4)} and a ${memoryLimitBytes}-byte limit. Suggest one kubectl command to mitigate the risk.`,
    },
  ]);
  return String(response.content).trim();
}

async function main() {
  const config = loadConfig();
  const kubernetes = new KubernetesClient({
    httpClient: axios,
    baseUrl: config.kubernetesApiUrl,
    namespace: config.namespace,
    podName: config.podName,
    containerName: config.containerName,
    timeoutMs: config.requestTimeoutMs,
  });
  const prometheus = new PrometheusClient({ httpClient: axios, baseUrl: config.prometheusUrl, timeoutMs: config.requestTimeoutMs });
  const engine = new PredictionEngine({ pythonBin: config.pythonBin, scriptPath: config.modelScript, cwd: config.projectRoot });
  const memoryQuery = buildMemoryQuery(config);
  const memoryLimitBytes = await kubernetes.getMemoryLimitBytes();
  const window = [];
  let stopping = false;

  const stop = () => {
    stopping = true;
    engine.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log(`[KubePulse] Monitoring ${config.namespace}/${config.podName} every ${config.pollIntervalMs} ms`);
  while (!stopping) {
    const startedAt = Date.now();
    try {
      const memoryBytes = await prometheus.queryScalar(memoryQuery);
      window.push(memoryBytes / memoryLimitBytes);
      if (window.length > config.windowSize) window.shift();

      if (window.length < config.windowSize) {
        console.log(`[KubePulse] Warm-up ${window.length}/${config.windowSize}`);
      } else {
        const prediction = await engine.predict(
          { podName: config.podName, memoryUsage: window },
          config.predictionTimeoutMs,
        );
        try {
          await axios.post(config.exporterUrl, {
            podName: config.podName,
            predictedMemory: prediction.predictedMemory,
            isAnomaly: prediction.isAnomaly,
          }, { timeout: config.requestTimeoutMs });
        } catch (error) {
          console.error(`[Exporter] Prediction could not be reported: ${error.message}`);
        }

        const result = await routePrediction({
          prediction,
          podName: config.podName,
          memoryLimitBytes,
          isCrashLooping: () => kubernetes.isCrashLooping(),
          suggestCommand,
        });
        if (result.outcome === "healthy") {
          console.log(`✅ Healthy. Predicted memory ratio: ${prediction.predictedMemory.toFixed(4)}`);
        } else if (result.outcome === "escalated") {
          console.error(`⚠️ CRITICAL: ${config.podName} is in CrashLoopBackOff; notify an administrator.`);
        } else {
          console.warn(`⚠️ Anomaly. Suggested command (not executed): ${result.command}`);
        }
      }
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
