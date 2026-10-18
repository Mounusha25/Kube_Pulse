# Real-cluster HPA comparison

Generated on `2026-10-18T08:50:13.795020+00:00` against context `minikube`.

| Trial | First scale (s) | Peak replicas | Replica-seconds | Peak memory (MiB) | Restarts | OOM events | Failed requests |
|---|---:|---:|---:|---:|---:|---:|---:|
| standard-hpa | 75.03 | 4 | 255 | 148.0 | 0 | 0 | 0 |
| predictive-hpa | 45.08 | 6 | 555 | 283.0 | 0 | 0 | 0 |

## Direct comparison

Predictive lead time versus the standard HPA: `29.95` seconds (positive means predictive scaled earlier).
Replica-second delta (predictive - standard): `300`.

These measurements come from a local Minikube cluster; they are not the synthetic model benchmark.
