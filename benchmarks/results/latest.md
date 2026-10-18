# KubePulse ML Benchmark

Dataset: `data/kubepulse_benchmark.csv` · 14,400 rows · 24 traces · chronological 60/20/20 split

## Forecast accuracy

| Model | MAE | RMSE |
|---|---:|---:|
| persistence | 0.0215 | 0.0424 |
| moving_average_5 | 0.0424 | 0.0827 |
| linear_trend_5 | 0.0211 | 0.0422 |
| lstm_v2 | 0.0201 | 0.0397 |

## Imminent-breach classification

A positive label means memory reaches its configured limit within the next 10 seconds.

| Method | Precision | Recall | F1 | PR-AUC | False-alert rate | Event recall | Mean warning |
|---|---:|---:|---:|---:|---:|---:|---:|
| static_threshold_0.85 | 0.692 | 0.835 | 0.757 | 0.849 | 0.064 | 1.000 | 6.11s |
| prometheus_0.90_for_3 | 0.767 | 0.740 | 0.753 | 0.808 | 0.039 | 0.684 | 6.46s |
| linear_trend_5 | 0.766 | 0.843 | 0.802 | 0.874 | 0.044 | 1.000 | 6.26s |
| hybrid_lstm_lightgbm_v2 | 0.868 | 0.812 | 0.839 | 0.881 | 0.021 | 1.000 | 5.84s |

These results use deterministic synthetic workload traces for regression testing. They are not a production-cluster claim.
