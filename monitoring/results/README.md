# Live drift-monitoring smoke test

This evidence was captured from the local Minikube stack on
`2026-10-18T09:48:04Z`. After 94 paired live samples, the exporter reported
input PSI `21.2921`, prediction PSI `21.2815`, `drift_ready=1`,
`drift_detected=1`, and `retraining_recommended=1`. The Prometheus Operator
accepted the included alert rule (`prometheus-operator-validated=true`).

The workload was idle, while the versioned synthetic training set is
concentrated at higher memory ratios. This is intentionally recorded as a
training-coverage gap detected by monitoring—not as evidence that retraining
has already solved it. A candidate should incorporate reviewed, representative
idle data and must pass evaluation before any deployment decision.
