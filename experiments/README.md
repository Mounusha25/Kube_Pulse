# Real-cluster autoscaling experiment

This experiment compares the standard Kubernetes memory HPA with a predictive
HPA driven by KubePulse's `kubeguard_predicted_memory_ratio` metric. Both trials
use the same StatefulSet, deterministic ramp load, replica limits, and 150-second
measurement window.

## Stack

- Minikube and Metrics Server
- kube-prometheus-stack and Prometheus Adapter
- KubePulse Node/Python agent running the versioned LSTM + LightGBM artifacts
- Go prediction exporter and `ServiceMonitor`
- Stateful memory workload and distributed ramp load generator

The setup uses in-cluster service-account authentication and namespace-scoped
read-only RBAC. LLM remediation is disabled during measurement.

## Reproduce

Prerequisites: Docker Desktop, `minikube`, `kubectl`, `helm`, and Python 3.10+.

```bash
./scripts/setup_minikube_experiment.sh
python3 experiments/run_cluster_comparison.py --duration 150 --interval 5
```

The runner refuses to operate unless the active context is `minikube`. Before
each trial it removes both HPAs, stops the load generator, converges to exactly
one ready workload pod, recreates that pod, and restarts the agent to clear its
sliding window.

Outputs are written to `experiments/results/cluster/`:

- `standard-hpa.csv` and `predictive-hpa.csv`: raw five-second samples
- `summary.json`: machine-readable metrics
- `REPORT.md`: comparison table and deltas

## Recorded result

On the checked-in run, predictive scaling began **29.95 seconds earlier** than
the standard HPA (45.08s versus 75.03s). Both trials recorded zero request
failures, restarts, and OOM events. The predictive policy also consumed more
capacity—555 versus 255 replica-seconds and a peak of six versus four replicas.

That cost is deliberately reported: the result demonstrates earlier response,
not a claim that the current threshold is cost-optimal. Production use would
require tuning on representative cluster traffic and repeated statistical runs.

