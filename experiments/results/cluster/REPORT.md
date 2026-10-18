# Real-cluster HPA comparison

Generated on `2026-10-18T09:32:13.664951+00:00` against context `minikube`.

| Trial | First scale (s) | Peak replicas | Replica-seconds | Peak memory (MiB) | Restarts | OOM events | Failed requests |
|---|---:|---:|---:|---:|---:|---:|---:|
| standard-hpa | 75.14 | 4 | 255 | 164.0 | 0 | 0 | 0 |
| predictive-hpa | 15.02 | 4 | 405 | 216.0 | 0 | 0 | 0 |

## Direct comparison

Predictive lead time versus the standard HPA: `60.12` seconds (positive means predictive scaled earlier).
Replica-second delta (predictive - standard): `150`.

These measurements come from a local Minikube cluster; they are not the synthetic model benchmark.
