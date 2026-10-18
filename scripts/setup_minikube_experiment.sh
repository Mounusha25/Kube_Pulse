#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! minikube status >/dev/null 2>&1; then
  minikube start --cpus=4 --memory=7168
fi

minikube addons enable metrics-server
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
  --wait \
  --timeout 10m

helm upgrade --install prometheus-adapter prometheus-community/prometheus-adapter \
  --namespace monitoring \
  --values experiments/k8s/prometheus-adapter-values.yaml \
  --wait \
  --timeout 5m

minikube image build -t kubepulse-agent:dev -f docker/Dockerfile.agent .
minikube image build -t kubeguard-exporter:dev kubeguard-exporter

kubectl delete statefulset/memory-workload -n kubepulse-lab --ignore-not-found
kubectl apply -k experiments/k8s
kubectl rollout restart deployment/kubeguard-exporter deployment/kubepulse-agent -n kubepulse-lab
kubectl rollout status deployment/memory-workload -n kubepulse-lab --timeout=3m
kubectl rollout status deployment/kubeguard-exporter -n kubepulse-lab --timeout=3m
kubectl rollout status deployment/kubepulse-agent -n kubepulse-lab --timeout=5m

echo "KubePulse experiment stack is ready."
echo "Run: python3 experiments/run_cluster_comparison.py"

