"""Run matched reactive-HPA and predictive-HPA trials on the local cluster."""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = ROOT / "experiments" / "k8s"
NAMESPACE = "kubepulse-lab"


def kubectl(*args: str, check: bool = True, command_timeout: int = 30) -> str:
    result = subprocess.run(
        ["kubectl", *args],
        check=False,
        capture_output=True,
        text=True,
        timeout=command_timeout,
    )
    if check and result.returncode:
        raise RuntimeError(f"kubectl {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def quantity_to_mib(value: str) -> float:
    units = {
        "Ki": 1 / 1024,
        "Mi": 1,
        "Gi": 1024,
        "K": 1000 / 2**20,
        "M": 1_000_000 / 2**20,
        "G": 1_000_000_000 / 2**20,
    }
    for unit, multiplier in units.items():
        if value.endswith(unit):
            return float(value[: -len(unit)]) * multiplier
    return float(value) / 2**20


def workload_state() -> dict[str, Any]:
    deployment = json.loads(kubectl("get", "deployment/memory-workload", "-n", NAMESPACE, "-o", "json"))
    pods = json.loads(kubectl("get", "pods", "-n", NAMESPACE, "-l", "app=memory-workload", "-o", "json"))
    desired = int(deployment.get("spec", {}).get("replicas", 0))
    ready = int(deployment.get("status", {}).get("readyReplicas", 0))
    restarts = 0
    oom_events = 0
    for pod in pods.get("items", []):
        for status in pod.get("status", {}).get("containerStatuses", []):
            restarts += int(status.get("restartCount", 0))
            last_reason = status.get("lastState", {}).get("terminated", {}).get("reason")
            current_reason = status.get("state", {}).get("terminated", {}).get("reason")
            oom_events += int(last_reason == "OOMKilled") + int(current_reason == "OOMKilled")
    return {"replicas": desired, "ready_replicas": ready, "restarts": restarts, "oom_events": oom_events}


def memory_mib() -> float | None:
    output = kubectl(
        "top", "pods", "-n", NAMESPACE, "-l", "app=memory-workload", "--no-headers", check=False
    )
    if not output:
        return None
    total = 0.0
    parsed = False
    for line in output.splitlines():
        columns = line.split()
        if len(columns) >= 3:
            total += quantity_to_mib(columns[2])
            parsed = True
    return round(total, 3) if parsed else None


def predicted_ratio() -> tuple[float | None, int]:
    raw = kubectl(
        "get",
        "--raw",
        f"/apis/custom.metrics.k8s.io/v1beta1/namespaces/{NAMESPACE}/pods/*/kubeguard_predicted_memory_ratio?labelSelector=app%3Dmemory-workload",
        check=False,
    )
    if not raw:
        return None, 0
    try:
        items = json.loads(raw).get("items", [])
        values = [float(item["value"].removesuffix("m")) / 1000 for item in items]
        return (sum(values) / len(values), len(values)) if values else (None, 0)
    except (ValueError, KeyError, IndexError, json.JSONDecodeError):
        return None, 0


def wait_for_single_workload(timeout_seconds: int = 180) -> str:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        deployment = json.loads(
            kubectl("get", "deployment/memory-workload", "-n", NAMESPACE, "-o", "json")
        )
        pods = json.loads(
            kubectl("get", "pods", "-n", NAMESPACE, "-l", "app=memory-workload", "-o", "json")
        )
        active_pods = [
            pod for pod in pods.get("items", []) if not pod.get("metadata", {}).get("deletionTimestamp")
        ]
        status = deployment.get("status", {})
        if (
            int(deployment.get("spec", {}).get("replicas", 0)) == 1
            and int(status.get("readyReplicas", 0)) == 1
            and len(active_pods) == 1
        ):
            return active_pods[0]["metadata"]["name"]
        time.sleep(2)
    raise RuntimeError("workload did not converge to exactly one ready pod")


def wait_for_no_load_generator(timeout_seconds: int = 120) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        pods = json.loads(
            kubectl("get", "pods", "-n", NAMESPACE, "-l", "app=load-generator", "-o", "json")
        )
        active = [
            pod for pod in pods.get("items", []) if not pod.get("metadata", {}).get("deletionTimestamp")
        ]
        if not active:
            return
        time.sleep(1)
    raise RuntimeError("load generator did not stop")


@dataclass
class Sample:
    elapsed_seconds: float
    replicas: int
    ready_replicas: int
    total_memory_mib: float | None
    predicted_memory_ratio: float | None
    predicted_pod_count: int
    restarts: int
    oom_events: int


def reset_workload() -> None:
    kubectl("delete", "hpa", "memory-workload-standard", "memory-workload-predictive", "-n", NAMESPACE, "--ignore-not-found")
    kubectl("scale", "deployment/load-generator", "-n", NAMESPACE, "--replicas=0")
    wait_for_no_load_generator()
    kubectl("scale", "deployment/memory-workload", "-n", NAMESPACE, "--replicas=1")
    pod_name = wait_for_single_workload()
    kubectl(
        "delete", f"pod/{pod_name}", "-n", NAMESPACE, "--wait=true", command_timeout=180
    )
    kubectl(
        "rollout", "status", "deployment/memory-workload", "-n", NAMESPACE, "--timeout=3m", command_timeout=210
    )
    wait_for_single_workload()
    # Metrics Server can briefly retain samples for the recreated pod name. A
    # quiet period prevents stale load from influencing the next HPA trial.
    time.sleep(30)
    kubectl("rollout", "restart", "deployment/kubeguard-exporter", "-n", NAMESPACE)
    kubectl(
        "rollout", "status", "deployment/kubeguard-exporter", "-n", NAMESPACE,
        "--timeout=3m", command_timeout=210,
    )
    kubectl("rollout", "restart", "deployment/kubepulse-agent", "-n", NAMESPACE)
    kubectl(
        "rollout", "status", "deployment/kubepulse-agent", "-n", NAMESPACE, "--timeout=3m", command_timeout=210
    )
    time.sleep(10)


def run_trial(name: str, hpa_manifest: Path, duration: int, interval: int) -> tuple[list[Sample], dict[str, Any]]:
    reset_workload()
    kubectl("apply", "-f", str(hpa_manifest))
    kubectl("scale", "deployment/load-generator", "-n", NAMESPACE, "--replicas=1")
    kubectl(
        "rollout", "status", "deployment/load-generator", "-n", NAMESPACE, "--timeout=2m", command_timeout=150
    )

    started = time.monotonic()
    samples: list[Sample] = []
    print(f"\n{name}: collecting {duration} seconds of cluster measurements")
    try:
        while time.monotonic() - started <= duration:
            elapsed = round(time.monotonic() - started, 2)
            state = workload_state()
            ratio, metric_pod_count = predicted_ratio()
            sample = Sample(
                elapsed_seconds=elapsed,
                total_memory_mib=memory_mib(),
                predicted_memory_ratio=round(ratio, 6) if ratio is not None else None,
                predicted_pod_count=metric_pod_count,
                **state,
            )
            samples.append(sample)
            print(
                f"  t={elapsed:6.1f}s replicas={sample.replicas} ready={sample.ready_replicas} "
                f"memory={sample.total_memory_mib}Mi predicted={sample.predicted_memory_ratio}"
            )
            time.sleep(max(0, interval - (time.monotonic() - started - elapsed)))
    finally:
        load_logs = kubectl("logs", "-n", NAMESPACE, "deployment/load-generator", check=False)
        kubectl("scale", "deployment/load-generator", "-n", NAMESPACE, "--replicas=0", check=False)
        kubectl("delete", "-f", str(hpa_manifest), "--ignore-not-found", check=False)

    first_scale = next((sample.elapsed_seconds for sample in samples if sample.replicas > 1), None)
    replica_seconds = round(sum(sample.replicas * interval for sample in samples), 2)
    memory_values = [sample.total_memory_mib for sample in samples if sample.total_memory_mib is not None]
    summary = {
        "trial": name,
        "duration_seconds": duration,
        "time_to_first_scale_seconds": first_scale,
        "peak_replicas": max((sample.replicas for sample in samples), default=0),
        "replica_seconds": replica_seconds,
        "peak_total_memory_mib": max(memory_values, default=None),
        "max_restarts": max((sample.restarts for sample in samples), default=0),
        "oom_events": max((sample.oom_events for sample in samples), default=0),
        "load_generator_failures": load_logs.count("request failed:"),
    }
    return samples, summary


def write_results(output: Path, trials: list[tuple[list[Sample], dict[str, Any]]]) -> None:
    output.mkdir(parents=True, exist_ok=True)
    summaries = []
    for samples, summary in trials:
        summaries.append(summary)
        with (output / f"{summary['trial']}.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=asdict(samples[0]).keys(), lineterminator="\n")
            writer.writeheader()
            writer.writerows(asdict(sample) for sample in samples)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cluster_context": kubectl("config", "current-context"),
        "trials": summaries,
    }
    (output / "summary.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    by_name = {summary["trial"]: summary for summary in summaries}
    standard = by_name["standard-hpa"]
    predictive = by_name["predictive-hpa"]
    first_scale_delta = None
    if standard["time_to_first_scale_seconds"] is not None and predictive["time_to_first_scale_seconds"] is not None:
        first_scale_delta = round(
            standard["time_to_first_scale_seconds"] - predictive["time_to_first_scale_seconds"], 2
        )
    lines = [
        "# Real-cluster HPA comparison",
        "",
        f"Generated on `{payload['generated_at']}` against context `{payload['cluster_context']}`.",
        "",
        "| Trial | First scale (s) | Peak replicas | Replica-seconds | Peak memory (MiB) | Restarts | OOM events | Failed requests |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for summary in summaries:
        lines.append(
            f"| {summary['trial']} | {summary['time_to_first_scale_seconds']} | {summary['peak_replicas']} | "
            f"{summary['replica_seconds']} | {summary['peak_total_memory_mib']} | {summary['max_restarts']} | "
            f"{summary['oom_events']} | {summary['load_generator_failures']} |"
        )
    lines.extend(
        [
            "",
            "## Direct comparison",
            "",
            f"Predictive lead time versus the standard HPA: `{first_scale_delta}` seconds (positive means predictive scaled earlier).",
            f"Replica-second delta (predictive - standard): `{round(predictive['replica_seconds'] - standard['replica_seconds'], 2)}`.",
            "",
            "These measurements come from a local Minikube cluster; they are not the synthetic model benchmark.",
        ]
    )
    (output / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=int, default=150)
    parser.add_argument("--interval", type=int, default=5)
    parser.add_argument("--output", type=Path, default=ROOT / "experiments" / "results" / "cluster")
    args = parser.parse_args()
    if args.duration < 30 or args.interval < 1:
        parser.error("duration must be at least 30 seconds and interval at least 1 second")

    if kubectl("config", "current-context") != "minikube":
        raise SystemExit("Refusing to run: kubectl context must be 'minikube'.")
    kubectl("get", "namespace", NAMESPACE)

    trials = [
        run_trial("standard-hpa", MANIFESTS / "hpa-standard.yaml", args.duration, args.interval),
        run_trial("predictive-hpa", MANIFESTS / "hpa-predictive.yaml", args.duration, args.interval),
    ]
    write_results(args.output, trials)
    print(f"\nResults written to {args.output}")


if __name__ == "__main__":
    main()

