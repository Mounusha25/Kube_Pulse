function escapeLabel(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

export function buildMemoryQuery({ namespace, podName, containerName = null }) {
  const labels = [`namespace="${escapeLabel(namespace)}"`, `pod="${escapeLabel(podName)}"`, 'container!=""', 'image!=""'];
  if (containerName) labels.push(`container="${escapeLabel(containerName)}"`);
  return `sum(container_memory_usage_bytes{${labels.join(",")}})`;
}

export class PrometheusClient {
  constructor({ httpClient, baseUrl, timeoutMs = 5000 }) {
    Object.assign(this, { httpClient, baseUrl, timeoutMs });
  }

  async queryScalar(query) {
    const response = await this.httpClient.get(`${this.baseUrl}/api/v1/query`, { params: { query }, timeout: this.timeoutMs });
    if (response.data?.status !== "success") throw new Error("Prometheus query failed");
    const result = response.data?.data?.result || [];
    if (result.length !== 1) throw new Error(`Prometheus query returned ${result.length} series; expected one`);
    const value = Number(result[0]?.value?.[1]);
    if (!Number.isFinite(value)) throw new Error("Prometheus returned a non-numeric value");
    return value;
  }
}
