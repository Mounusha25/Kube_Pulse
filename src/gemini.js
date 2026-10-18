export async function suggestCommandWithGemini({
  httpClient,
  env,
  podName,
  predictedMemory,
  memoryLimitBytes,
}) {
  const apiKey = env.GOOGLE_API_KEY?.trim();
  const model = env.KUBEPULSE_GEMINI_MODEL?.trim();
  if (!apiKey || !model) {
    throw new Error("GOOGLE_API_KEY and KUBEPULSE_GEMINI_MODEL are required when remediation is enabled");
  }
  const response = await httpClient.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      systemInstruction: {
        parts: [{ text: "You are a Kubernetes SRE assistant. Return one suggested kubectl command only. Never execute it." }],
      },
      contents: [{
        role: "user",
        parts: [{
          text: `Pod ${podName} has predicted memory ratio ${predictedMemory.toFixed(4)} and a ${memoryLimitBytes}-byte limit. Suggest one kubectl command to mitigate the risk.`,
        }],
      }],
      generationConfig: { temperature: 0 },
    },
    {
      headers: { "x-goog-api-key": apiKey },
      timeout: 10000,
      maxContentLength: 1024 * 1024,
    },
  );
  const command = response.data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!command) throw new Error("Gemini returned no remediation suggestion");
  return command;
}

