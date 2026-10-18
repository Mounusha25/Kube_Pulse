const QUANTITY_PATTERN = /^([0-9]+(?:\.[0-9]+)?)([EPTGMK]i?|m)?$/;
const DECIMAL_FACTORS = { K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };
const BINARY_FACTORS = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 };

export function parseMemoryQuantityToBytes(quantity) {
  if (typeof quantity !== "string" || quantity.trim() === "") throw new Error("Kubernetes memory limit is missing");
  const match = quantity.trim().match(QUANTITY_PATTERN);
  if (!match) throw new Error(`Unsupported Kubernetes memory quantity: ${quantity}`);
  const value = Number(match[1]);
  const suffix = match[2] || "";
  let factor = 1;
  if (suffix === "m") factor = 0.001;
  else if (suffix in DECIMAL_FACTORS) factor = DECIMAL_FACTORS[suffix];
  else if (suffix in BINARY_FACTORS) factor = BINARY_FACTORS[suffix];
  const bytes = value * factor;
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error(`Kubernetes memory quantity must be positive: ${quantity}`);
  return bytes;
}

export class KubernetesClient {
  constructor({ httpClient, baseUrl, namespace, podName = null, podSelector = null, containerName = null, timeoutMs = 5000 }) {
    Object.assign(this, { httpClient, baseUrl, namespace, podName, podSelector, containerName, timeoutMs });
  }

  async getPod(podName = this.podName) {
    if (!podName) throw new Error("A pod name is required");
    const namespace = encodeURIComponent(this.namespace);
    const pod = encodeURIComponent(podName);
    const response = await this.httpClient.get(`${this.baseUrl}/api/v1/namespaces/${namespace}/pods/${pod}`, { timeout: this.timeoutMs });
    return response.data;
  }

  async listPods() {
    if (this.podName) return [await this.getPod(this.podName)];
    if (!this.podSelector) throw new Error("A pod name or selector is required");
    const namespace = encodeURIComponent(this.namespace);
    const response = await this.httpClient.get(`${this.baseUrl}/api/v1/namespaces/${namespace}/pods`, {
      params: { labelSelector: this.podSelector },
      timeout: this.timeoutMs,
    });
    return (response.data?.items || []).filter((pod) => !pod?.metadata?.deletionTimestamp);
  }

  selectContainer(pod, podName = pod?.metadata?.name || this.podName) {
    const containers = pod?.spec?.containers || [];
    const container = this.containerName ? containers.find((item) => item.name === this.containerName) : containers[0];
    if (!container) throw new Error(`Pod ${podName || "<unknown>"} has no matching container`);
    return container;
  }

  getMemoryLimitBytesFromPod(pod) {
    const container = this.selectContainer(pod);
    return parseMemoryQuantityToBytes(container?.resources?.limits?.memory);
  }

  async getMemoryLimitBytes(podName = this.podName) {
    return this.getMemoryLimitBytesFromPod(await this.getPod(podName));
  }

  async isCrashLooping(podName = this.podName) {
    const pod = await this.getPod(podName);
    const statuses = pod?.status?.containerStatuses || [];
    const status = this.containerName ? statuses.find((item) => item.name === this.containerName) : statuses[0];
    return status?.state?.waiting?.reason === "CrashLoopBackOff";
  }
}
