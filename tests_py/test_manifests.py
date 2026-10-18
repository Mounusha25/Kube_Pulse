from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
K8S = ROOT / "experiments" / "k8s"


def read(name: str) -> str:
    return (K8S / name).read_text(encoding="utf-8")


def test_agent_uses_label_discovery_not_a_fixed_pod() -> None:
    manifest = read("agent.yaml")
    assert "KUBEPULSE_POD_SELECTOR" in manifest
    assert "KUBEPULSE_POD_NAME" not in manifest


def test_adapter_exposes_a_pod_custom_metric() -> None:
    values = read("prometheus-adapter-values.yaml")
    assert "custom:" in values
    assert "external:" not in values
    assert "resource: pod" in values
    assert "by (<<.GroupBy>>)" in values


def test_predictive_hpa_uses_per_pod_average_value() -> None:
    hpa = read("hpa-predictive.yaml")
    assert "kind: Deployment" in hpa
    assert "type: Pods" in hpa
    assert "type: AverageValue" in hpa
    assert "averageValue: 350m" in hpa


def test_experiment_workload_has_unique_deployment_pod_identities() -> None:
    workload = read("workload.yaml")
    assert "kind: Deployment" in workload
    assert "kind: StatefulSet" not in workload
