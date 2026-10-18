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
  constructor({ httpClient, baseUrl, namespace, podName, containerName = null, timeoutMs = 5000 }) {
    Object.assign(this, { httpClient, baseUrl, namespace, podName, containerName, timeoutMs });
  }

  async getPod() {
    const namespace = encodeURIComponent(this.namespace);
    const pod = encodeURIComponent(this.podName);
    const response = await this.httpClient.get(`${this.baseUrl}/api/v1/namespaces/${namespace}/pods/${pod}`, { timeout: this.timeoutMs });
    return response.data;
  }

  selectContainer(pod) {
    const containers = pod?.spec?.containers || [];
    const container = this.containerName ? containers.find((item) => item.name === this.containerName) : containers[0];
    if (!container) throw new Error(`Pod ${this.podName} has no matching container`);
    return container;
  }

  async getMemoryLimitBytes() {
    const container = this.selectContainer(await this.getPod());
    return parseMemoryQuantityToBytes(container?.resources?.limits?.memory);
  }

  async isCrashLooping() {
    const pod = await this.getPod();
    const statuses = pod?.status?.containerStatuses || [];
    const status = this.containerName ? statuses.find((item) => item.name === this.containerName) : statuses[0];
    return status?.state?.waiting?.reason === "CrashLoopBackOff";
  }
}
