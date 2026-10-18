import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function parsePredictionLine(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    throw new Error(`ML engine returned invalid JSON: ${line}`);
  }
  const predictedMemory = Number(payload.predictedMemory);
  if (!Number.isFinite(predictedMemory) || ![0, 1].includes(payload.isAnomaly)) {
    throw new Error(`ML engine returned an invalid prediction: ${line}`);
  }
  return { predictedMemory, isAnomaly: payload.isAnomaly };
}

export class PredictionEngine {
  constructor({ pythonBin, scriptPath, cwd, spawnProcess = spawn, logger = console }) {
    Object.assign(this, { pythonBin, scriptPath, cwd, spawnProcess, logger });
    this.process = null;
    this.pending = [];
  }

  start() {
    if (this.process) return;
    const child = this.spawnProcess(this.pythonBin, ["-u", this.scriptPath], { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.process = child;
    createInterface({ input: child.stdout }).on("line", (line) => {
      const request = this.pending.shift();
      if (!request) return this.logger.warn(`[ML] Ignoring prediction without a request: ${line}`);
      clearTimeout(request.timer);
      try {
        request.resolve(parsePredictionLine(line));
      } catch (error) {
        request.reject(error);
      }
    });
    child.stderr.on("data", (data) => this.logger.error(`[ML] ${data.toString().trim()}`));
    child.on("error", (error) => this.fail(child, error));
    child.on("exit", (code, signal) => this.fail(child, new Error(`ML engine exited (code=${code}, signal=${signal})`)));
  }

  fail(child, error, terminate = false) {
    if (this.process !== child) return;
    this.process = null;
    if (terminate) child.kill("SIGTERM");
    for (const request of this.pending.splice(0)) {
      clearTimeout(request.timer);
      request.reject(error);
    }
  }

  async predict(payload, timeoutMs = 10000) {
    if (!this.process) this.start();
    return new Promise((resolve, reject) => {
      const child = this.process;
      const request = { resolve, reject, timer: null };
      request.timer = setTimeout(() => {
        this.fail(child, new Error(`ML prediction timed out after ${timeoutMs} ms`), true);
      }, timeoutMs);
      this.pending.push(request);
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        const index = this.pending.indexOf(request);
        if (index >= 0) this.pending.splice(index, 1);
        clearTimeout(request.timer);
        reject(error);
      });
    });
  }

  stop() {
    const child = this.process;
    if (!child) return;
    this.process = null;
    child.stdin.end();
    child.kill("SIGTERM");
    for (const request of this.pending.splice(0)) {
      clearTimeout(request.timer);
      request.reject(new Error("ML engine stopped"));
    }
  }
}
