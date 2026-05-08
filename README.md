# 🛡️ KubeGuard — Autonomous Kubernetes AI Monitoring Agent

![KubeGuard Banner](./banner.png)

> **Real-time pod anomaly detection and LLM-powered self-healing for Kubernetes workloads.**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat&logo=python&logoColor=white)](https://python.org/)
[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat&logo=go&logoColor=white)](https://golang.org/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-API-326CE5?style=flat&logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-E6522C?style=flat&logo=prometheus&logoColor=white)](https://prometheus.io/)
[![TensorFlow](https://img.shields.io/badge/TensorFlow-LSTM-FF6F00?style=flat&logo=tensorflow&logoColor=white)](https://tensorflow.org/)
[![LangChain](https://img.shields.io/badge/LangChain-Gemini%201.5%20Pro-1C3C3C?style=flat)](https://langchain.com/)

---

## Overview

**KubeGuard** is an autonomous AIOps agent that continuously monitors Kubernetes pod memory usage, predicts anomalies before they cause outages, and leverages a Large Language Model to automatically suggest remediation commands — all in real time.

Traditional Kubernetes monitoring tools alert you *after* a problem occurs. KubeGuard is **predictive**: it uses a hybrid LSTM + LightGBM ML pipeline to forecast memory behavior and detect anomalies before they escalate into `CrashLoopBackOff` or OOMKilled events.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        KubeGuard Agent                          │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │  Prometheus  │───▶│  Node.js     │───▶│  Python ML Engine │  │
│  │  (Metrics)   │    │  Orchestrator│    │  (LSTM + LightGBM)│  │
│  └──────────────┘    └──────┬───────┘    └────────┬──────────┘  │
│           ▲                 │                     │             │
│           │        POST     │            Anomaly? │             │
│  ┌────────┴───────┐         │                     ▼             │
│  │  Go Prometheus │◀────────┘         ┌───────────────────────┐ │
│  │  Exporter      │  /report          │  Gemini 1.5 Pro (LLM) │ │
│  │  /metrics      │                   │  kubectl fix command  │ │
│  └────────────────┘                   └───────────────────────┘ │
│  ┌──────────────┐                                               │
│  │  Kubernetes  │◀── HPA can scale based on custom metrics      │
│  │  API Server  │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Metrics Collection** — Queries Prometheus every second for `container_memory_usage_bytes` of the target pod
2. **Normalization** — Memory values are normalized against the pod's configured memory limit (fetched from K8s API)
3. **Sliding Window** — Maintains a rolling window of 10 data points fed as a time-series sequence
4. **ML Prediction** — The Node.js process streams the window to a Python subprocess via `stdin`; the LSTM model forecasts the next memory value
5. **Anomaly Classification** — The predicted value is passed to a LightGBM classifier to determine if it's anomalous
6. **Metrics Export** — Every prediction (healthy or anomalous) is POSTed to the **Go Prometheus Exporter** which exposes custom metrics on `/metrics` for Prometheus to scrape
7. **LLM Remediation** — If an anomaly is detected, the agent queries **Gemini 1.5 Pro** with full pod context and gets a targeted `kubectl` fix command
8. **Critical Triage** — If the pod is already in `CrashLoopBackOff`, the agent escalates to a cluster administrator alert instead of auto-remediating

---

## ML Pipeline

### Hybrid LSTM + LightGBM Model

| Component | Role | Details |
|-----------|------|---------|
| **LSTM** | Time-series forecasting | Trained on historical pod memory sequences (10-step input → next value) |
| **LightGBM** | Anomaly classification | Binary classifier on LSTM-predicted output: `0` = healthy, `1` = anomaly |

The **hybrid approach** separates concerns: LSTM captures temporal patterns in memory usage while LightGBM provides fast, interpretable anomaly classification on top of the forecast — a design that reduces false positives compared to threshold-based alerting.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Orchestration** | Node.js (ESM), Express |
| **Kubernetes Integration** | Kubernetes REST API (`kubectl proxy`) |
| **Metrics** | Prometheus + PromQL |
| **Custom Metrics Exporter** | Go 1.22, Prometheus `client_golang` SDK |
| **ML Inference** | TensorFlow/Keras (LSTM), LightGBM, NumPy |
| **LLM Integration** | LangChain + Google Gemini 1.5 Pro |
| **IPC** | Node.js `child_process` → Python subprocess via `stdin/stdout` |
| **Containerization** | Docker (multi-stage build) |
| **Deployment** | Kubernetes Deployment + Service YAML |

---

## Project Structure

```
KubeGuard/
├── index.js                        # Main agent: metrics collection, orchestration, LLM integration
├── hybrid_predict.py               # ML inference engine: LSTM + LightGBM anomaly detection
├── hybrid_lstm_model.keras         # Pre-trained LSTM model (TensorFlow/Keras)
├── hybrid_lstm_model.h5            # LSTM model (HDF5 format)
├── lightgbm_anomaly.pkl            # Trained LightGBM anomaly classifier
├── exp.js                          # Utility: K8s API exploration script
├── package.json                    # Node.js dependencies
└── kubeguard-exporter/             # Go Prometheus custom metrics exporter
    ├── main.go                     # HTTP server exposing /report and /metrics
    ├── go.mod                      # Go module definition
    ├── Dockerfile                  # Multi-stage Docker build
    └── k8s/
        └── exporter-deployment.yaml  # Kubernetes Deployment + Service
```

---

## Go Prometheus Exporter (`kubeguard-exporter`)

A purpose-built Go microservice that acts as the **metrics bridge** between the KubeGuard agent and Prometheus.

### Exposed Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /report` | POST | Receives JSON predictions from the Node.js agent |
| `GET /metrics` | GET | Prometheus scrape endpoint with custom metrics |
| `GET /healthz` | GET | Liveness/readiness health check |

### Custom Prometheus Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `kubeguard_predicted_memory_ratio` | Gauge | LSTM-forecasted memory usage (0–1, per pod label) |
| `kubeguard_anomaly_detected` | Gauge | 1 = anomaly active, 0 = healthy (per pod label) |
| `kubeguard_anomalies_total` | Counter | Cumulative anomaly count since exporter start |

### Deploy the Exporter

```bash
# Build the Docker image
cd kubeguard-exporter
docker build -t kubeguard-exporter:latest .

# Deploy to Kubernetes
kubectl apply -f k8s/exporter-deployment.yaml

# Verify it's running
kubectl get pods -l app=kubeguard-exporter
```

### HPA Integration (Horizontal Pod Autoscaler)

Since KubeGuard exposes `kubeguard_predicted_memory_ratio` as a real Prometheus metric, Kubernetes HPA can use it via the [Prometheus Adapter](https://github.com/kubernetes-sigs/prometheus-adapter) to **auto-scale workloads** based on predicted memory — closing the full AIOps loop.

---

## Getting Started

### Prerequisites

- Kubernetes cluster running locally (e.g., [minikube](https://minikube.sigs.k8s.io/) or [kind](https://kind.sigs.k8s.io/))
- Prometheus deployed in the cluster with `container_memory_usage_bytes` metrics available
- Python 3.10+ with pip
- Node.js 20+
- `kubectl proxy` running on `localhost:8001`

### 1. Clone the Repository

```bash
git clone https://github.com/Brijesh03032001/KubeGuard.git
cd KubeGuard
```

### 2. Install Node.js Dependencies

```bash
npm install
```

### 3. Install Python Dependencies

```bash
pip install tensorflow keras lightgbm numpy joblib
```

### 4. Start the Kubernetes API Proxy

```bash
kubectl proxy --port=8001
```

### 5. Configure the Target Pod

In `index.js`, update the pod name to match your deployment:

```js
const podName = "your-pod-name-here"
```

### 6. Run KubeGuard

```bash
npm run dev
```

KubeGuard will begin collecting metrics. After 10 seconds of warm-up, ML predictions start streaming and anomaly detection goes live.

---

## Sample Output

```
[KubeGuard] Collecting memory metrics...
[0.42, 0.45, 0.48, 0.51, 0.53, 0.58, 0.63, 0.71, 0.79, 0.88]

✅ Healthy. Predicted Memory: 0.91

⚠️  Anomaly Detected! Predicted Memory: 1.24 (exceeds limit)
🧠 LLM suggests: kubectl set resources deployment/finalpod --limits=memory=512Mi

⚠️  CRITICAL: Pod finalpod-77c649c5fc-tzvnb is leaking memory. Notify cluster administrator.
```

---

## How It Compares to Traditional Approaches

| Approach | Detection Timing | False Positives | Auto-Remediation |
|----------|-----------------|-----------------|-----------------|
| Threshold alerts | After breach | High | ❌ |
| Prometheus alerting rules | After breach | Medium | ❌ |
| **KubeGuard (LSTM + LightGBM)** | **Before breach** | **Low** | **✅ LLM-powered** |

---

## Key Engineering Decisions

- **Subprocess IPC over REST** — The Python ML engine runs as a persistent subprocess rather than a separate microservice, eliminating HTTP overhead for high-frequency (1 Hz) inference
- **Go for the metrics layer** — The exporter is written in Go using the official `prometheus/client_golang` SDK — the same stack used by production K8s operators — keeping the scrape path lightweight and idiomatic
- **Normalized memory inputs** — Memory is normalized against each pod's individual limit, making the model portable across pods with different memory configurations
- **LLM-as-last-resort** — The LLM is only invoked on confirmed anomalies, keeping API costs minimal while providing intelligent, context-aware remediation
- **CrashLoopBackOff triage** — Distinguishes between recoverable anomalies (auto-fix) and critical failures (human escalation), avoiding dangerous automated actions on already-failing pods

---

## Future Improvements

- [ ] Multi-pod monitoring with dynamic pod discovery
- [ ] CPU usage anomaly detection alongside memory
- [ ] Slack/PagerDuty integration for critical alerts
- [ ] Automatic execution of LLM-suggested commands (with approval workflow)
- [ ] Grafana dashboard for real-time anomaly visualization
- [ ] Model retraining pipeline on new cluster data

---

## Author

**Brijesh Kumar** — [GitHub](https://github.com/Brijesh03032001)

---

*Built with a focus on proactive reliability engineering for production Kubernetes environments.*
