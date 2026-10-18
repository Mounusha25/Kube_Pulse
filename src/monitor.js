import { buildMemoryQuery } from "./prometheus.js";
import { DriftDetector } from "./drift-detector.js";
import { routePrediction } from "./remediation.js";

export class MultiPodMonitor {
  constructor({
    kubernetes,
    prometheus,
    engine,
    reporter,
    suggestCommand,
    namespace,
    containerName = null,
    windowSize = 10,
    predictionTimeoutMs = 10000,
    remediationEnabled = false,
    driftReference = null,
    driftWindowSize = 120,
    driftMinimumSamples = 60,
    driftThreshold = 0.2,
    driftConsecutiveWindows = 3,
    logger = console,
  }) {
    Object.assign(this, {
      kubernetes,
      prometheus,
      engine,
      reporter,
      suggestCommand,
      namespace,
      containerName,
      windowSize,
      predictionTimeoutMs,
      remediationEnabled,
      driftReference,
      driftWindowSize,
      driftMinimumSamples,
      driftThreshold,
      driftConsecutiveWindows,
      logger,
    });
    this.states = new Map();
  }

  syncPods(pods) {
    const activeNames = new Set();
    for (const pod of pods) {
      const podName = pod?.metadata?.name;
      if (!podName) continue;
      let memoryLimitBytes;
      try {
        memoryLimitBytes = this.kubernetes.getMemoryLimitBytesFromPod(pod);
      } catch (error) {
        this.logger.error(`[KubePulse] Skipping ${podName}: ${error.message}`);
        continue;
      }
      activeNames.add(podName);
      const existing = this.states.get(podName);
      if (existing) {
        existing.memoryLimitBytes = memoryLimitBytes;
      } else {
        const drift = this.driftReference ? new DriftDetector({
          reference: this.driftReference,
          windowSize: this.driftWindowSize,
          minimumSamples: this.driftMinimumSamples,
          threshold: this.driftThreshold,
          consecutiveWindows: this.driftConsecutiveWindows,
        }) : null;
        this.states.set(podName, { memoryLimitBytes, window: [], drift, driftAlerted: false });
        this.logger.log(`[KubePulse] Discovered ${this.namespace}/${podName}`);
      }
    }
    for (const podName of this.states.keys()) {
      if (!activeNames.has(podName)) {
        this.states.delete(podName);
        this.logger.log(`[KubePulse] Removed stale target ${this.namespace}/${podName}`);
      }
    }
  }

  async poll() {
    const pods = await this.kubernetes.listPods();
    this.syncPods(pods);
    for (const podName of this.states.keys()) {
      try {
        await this.pollPod(podName);
      } catch (error) {
        this.logger.error(`[KubePulse] ${podName} poll failed: ${error.message}`);
      }
    }
    return this.states.size;
  }

  async pollPod(podName) {
    const state = this.states.get(podName);
    if (!state) return null;
    const memoryBytes = await this.prometheus.queryScalar(buildMemoryQuery({
      namespace: this.namespace,
      podName,
      containerName: this.containerName,
    }));
    const memoryRatio = memoryBytes / state.memoryLimitBytes;
    state.window.push(memoryRatio);
    state.drift?.observeInput(memoryRatio);
    if (state.window.length > this.windowSize) state.window.shift();
    if (state.window.length < this.windowSize) {
      this.logger.log(`[KubePulse] ${podName} warm-up ${state.window.length}/${this.windowSize}`);
      return null;
    }

    const prediction = await this.engine.predict(
      { podName, memoryUsage: state.window },
      this.predictionTimeoutMs,
    );
    const drift = state.drift?.observePrediction(prediction.predictedMemory) || {
      driftReady: 0,
      inputDriftPsi: 0,
      predictionDriftPsi: 0,
      driftDetected: 0,
      retrainingRecommended: 0,
      driftWindowSamples: 0,
    };
    if (drift.driftDetected === 1 && !state.driftAlerted) {
      this.logger.warn(
        `[Drift] ${podName} sustained distribution shift detected; manual retraining review recommended.`,
      );
      state.driftAlerted = true;
    } else if (drift.driftDetected === 0) {
      state.driftAlerted = false;
    }
    try {
      await this.reporter({
        podName,
        namespace: this.namespace,
        predictedMemory: prediction.predictedMemory,
        isAnomaly: prediction.isAnomaly,
        ...drift,
      });
    } catch (error) {
      this.logger.error(`[Exporter] ${podName} prediction could not be reported: ${error.message}`);
    }

    const result = await routePrediction({
      prediction,
      podName,
      memoryLimitBytes: state.memoryLimitBytes,
      isCrashLooping: () => this.kubernetes.isCrashLooping(podName),
      suggestCommand: this.suggestCommand,
      remediationEnabled: this.remediationEnabled,
    });
    if (result.outcome === "healthy") {
      this.logger.log(`✅ ${podName} healthy. Predicted memory ratio: ${prediction.predictedMemory.toFixed(4)}`);
    } else if (result.outcome === "escalated") {
      this.logger.error(`⚠️ CRITICAL: ${podName} is in CrashLoopBackOff; notify an administrator.`);
    } else if (result.outcome === "detected") {
      this.logger.warn(`⚠️ ${podName} anomaly detected. Automated remediation suggestions are disabled.`);
    } else {
      this.logger.warn(`⚠️ ${podName} anomaly. Suggested command (not executed): ${result.command}`);
    }
    return { prediction, result };
  }
}
