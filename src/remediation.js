export async function routePrediction({
  prediction,
  podName,
  memoryLimitBytes,
  isCrashLooping,
  suggestCommand,
  remediationEnabled = true,
}) {
  if (prediction.isAnomaly !== 1) return { outcome: "healthy", command: null };
  if (await isCrashLooping()) return { outcome: "escalated", command: null };
  if (!remediationEnabled) return { outcome: "detected", command: null };
  const command = await suggestCommand({ podName, predictedMemory: prediction.predictedMemory, memoryLimitBytes });
  return { outcome: "suggested", command };
}
