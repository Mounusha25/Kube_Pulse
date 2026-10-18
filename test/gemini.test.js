import test from "node:test";
import assert from "node:assert/strict";
import { suggestCommandWithGemini } from "../src/gemini.js";

const input = {
  podName: "api-0",
  predictedMemory: 1.125,
  memoryLimitBytes: 536870912,
};

test("requires explicit Gemini credentials and model", async () => {
  await assert.rejects(
    () => suggestCommandWithGemini({ ...input, env: {}, httpClient: {} }),
    /GOOGLE_API_KEY and KUBEPULSE_GEMINI_MODEL/,
  );
});

test("requests a suggestion without putting the API key in the URL", async () => {
  let request;
  const command = await suggestCommandWithGemini({
    ...input,
    env: { GOOGLE_API_KEY: "secret", KUBEPULSE_GEMINI_MODEL: "gemini-test" },
    httpClient: {
      post: async (...args) => {
        request = args;
        return { data: { candidates: [{ content: { parts: [{ text: "kubectl " }, { text: "top pod api-0" }] } }] } };
      },
    },
  });
  assert.equal(command, "kubectl top pod api-0");
  assert.match(request[0], /gemini-test:generateContent$/);
  assert.doesNotMatch(request[0], /secret/);
  assert.equal(request[2].headers["x-goog-api-key"], "secret");
  assert.match(request[1].contents[0].parts[0].text, /1\.1250/);
});

test("rejects an empty model response", async () => {
  await assert.rejects(
    () => suggestCommandWithGemini({
      ...input,
      env: { GOOGLE_API_KEY: "secret", KUBEPULSE_GEMINI_MODEL: "gemini-test" },
      httpClient: { post: async () => ({ data: { candidates: [] } }) },
    }),
    /returned no remediation suggestion/,
  );
});

