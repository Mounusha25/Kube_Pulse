import fs from "node:fs";
import https from "node:https";

export function createKubernetesHttpClient(axios, config) {
  if (!config.kubernetesApiUrl.startsWith("https://") || !fs.existsSync(config.serviceAccountTokenPath)) {
    return axios;
  }
  const token = fs.readFileSync(config.serviceAccountTokenPath, "utf8").trim();
  const ca = fs.existsSync(config.serviceAccountCaPath)
    ? fs.readFileSync(config.serviceAccountCaPath)
    : undefined;
  return axios.create({
    headers: { Authorization: `Bearer ${token}` },
    httpsAgent: new https.Agent({ ca, rejectUnauthorized: true }),
  });
}
