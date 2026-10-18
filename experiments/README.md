# Real-cluster autoscaling experiment

This experiment compares the standard Kubernetes memory HPA with a predictive
HPA driven by KubePulse's `kubeguard_predicted_memory_ratio` metric. Both trials
use the same Deployment, deterministic ramp load, replica limits, and 150-second
measurement window.

## Stack

- Minikube and Metrics Server
- kube-prometheus-stack and Prometheus Adapter
- KubePulse Node/Python agent with label-based pod discovery and independent windows
- Go prediction exporter and `ServiceMonitor`
- Deployment-based memory workload and distributed ramp load generator

The setup uses in-cluster service-account authentication and namespace-scoped
read-only RBAC. LLM remediation is disabled during measurement.

## Reproduce

Prerequisites: Docker Desktop, `minikube`, `kubectl`, `helm`, and Python 3.10+.

```bash
./scripts/setup_minikube_experiment.sh
python3 experiments/run_cluster_comparison.py --duration 150 --interval 5
```

The runner refuses to operate unless the active context is `minikube`. Before
each trial it removes both HPAs, fully stops the load generator, converges to
one ready workload pod, recreates it with a unique Deployment pod identity,
allows old metrics to expire, and restarts both exporter and agent. These steps
prevent state or stale Prometheus samples from leaking between policies.

Outputs are written to `experiments/results/cluster/`:

- `standard-hpa.csv` and `predictive-hpa.csv`: raw five-second samples
- `summary.json`: machine-readable metrics
- `REPORT.md`: comparison table and deltas

## Recorded result

On the checked-in run, predictive scaling began **60.12 seconds earlier** than
the standard HPA (15.02s versus 75.14s). Both trials recorded zero request
failures, restarts, and OOM events, and both peaked at four replicas. The
predictive policy consumed more capacity—405 versus 255 replica-seconds.

That cost is deliberately reported: the result demonstrates earlier response
and correct per-pod custom-metric scaling, not a claim that the `350m` target is
cost-optimal. Production use would require representative traffic and repeated
statistical trials.

