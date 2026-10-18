import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function positiveInteger(name, rawValue, fallback) {
  const value = rawValue === undefined ? fallback : Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function loadConfig(env = process.env) {
  const podName = env.KUBEPULSE_POD_NAME?.trim();
  if (!podName) throw new Error("KUBEPULSE_POD_NAME is required");
  return {
    podName,
    namespace: env.KUBEPULSE_NAMESPACE?.trim() || "default",
    containerName: env.KUBEPULSE_CONTAINER_NAME?.trim() || null,
    kubernetesApiUrl: (
      env.KUBEPULSE_KUBE_API_URL ||
      (env.KUBERNETES_SERVICE_HOST
        ? `https://${env.KUBERNETES_SERVICE_HOST}:${env.KUBERNETES_SERVICE_PORT || "443"}`
        : "http://localhost:8001")
    ).replace(/\/$/, ""),
    prometheusUrl: (env.KUBEPULSE_PROMETHEUS_URL || "http://localhost:9090").replace(/\/$/, ""),
    exporterUrl: env.KUBEPULSE_EXPORTER_URL || "http://localhost:8080/report",
    pollIntervalMs: positiveInteger("KUBEPULSE_POLL_INTERVAL_MS", env.KUBEPULSE_POLL_INTERVAL_MS, 1000),
    windowSize: positiveInteger("KUBEPULSE_WINDOW_SIZE", env.KUBEPULSE_WINDOW_SIZE, 10),
    requestTimeoutMs: positiveInteger("KUBEPULSE_REQUEST_TIMEOUT_MS", env.KUBEPULSE_REQUEST_TIMEOUT_MS, 5000),
    predictionTimeoutMs: positiveInteger("KUBEPULSE_PREDICTION_TIMEOUT_MS", env.KUBEPULSE_PREDICTION_TIMEOUT_MS, 10000),
    pythonBin: env.KUBEPULSE_PYTHON_BIN || "python3",
    modelScript: env.KUBEPULSE_MODEL_SCRIPT || path.join(projectRoot, "hybrid_predict.py"),
    serviceAccountTokenPath: env.KUBEPULSE_SA_TOKEN_PATH || "/var/run/secrets/kubernetes.io/serviceaccount/token",
    serviceAccountCaPath: env.KUBEPULSE_SA_CA_PATH || "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
    remediationEnabled: env.KUBEPULSE_REMEDIATION_ENABLED === "true",
    projectRoot,
  };
}
