from __future__ import annotations

import argparse
import json
import math
import platform
from pathlib import Path

import joblib
import numpy as np
import tensorflow as tf
from sklearn.metrics import accuracy_score, average_precision_score, precision_recall_fscore_support

from ml.dataset import DatasetSplit, build_splits, load_traces
from ml.features import classifier_features, linear_forecast


def forecast_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    error = predicted - actual
    return {
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(float(np.mean(error**2)))),
    }


def classification_metrics(actual: np.ndarray, predicted: np.ndarray, score: np.ndarray) -> dict[str, float]:
    precision, recall, f1, _ = precision_recall_fscore_support(
        actual, predicted, average="binary", zero_division=0
    )
    negatives = actual == 0
    false_alert_rate = float(np.mean(predicted[negatives] == 1)) if np.any(negatives) else 0.0
    return {
        "accuracy": float(accuracy_score(actual, predicted)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "pr_auc": float(average_precision_score(actual, score)),
        "false_alert_rate": false_alert_rate,
    }


def lead_time_metrics(split: DatasetSplit, alerts: np.ndarray, horizon: int) -> dict[str, float | int]:
    lead_times: list[int] = []
    breach_events = 0
    for trace_id in np.unique(split.trace_ids):
        positions = np.flatnonzero(split.trace_ids == trace_id)
        times = split.timestamps[positions]
        ratios = split.next_ratio[positions]
        local_alerts = alerts[positions]
        for index in range(1, len(positions)):
            if ratios[index] < 1.0 or ratios[index - 1] >= 1.0:
                continue
            breach_events += 1
            breach_time = int(times[index])
            candidates = times[(times >= breach_time - horizon) & (times <= breach_time) & (local_alerts == 1)]
            if len(candidates):
                lead_times.append(breach_time - int(np.min(candidates)))
    return {
        "breach_events": breach_events,
        "detected_events": len(lead_times),
        "event_recall": float(len(lead_times) / breach_events) if breach_events else 0.0,
        "mean_warning_seconds": float(np.mean(lead_times)) if lead_times else 0.0,
        "median_warning_seconds": float(np.median(lead_times)) if lead_times else 0.0,
    }


def write_markdown(results: dict, path: Path) -> None:
    lines = [
        "# KubePulse ML Benchmark",
        "",
        f"Dataset: `{results['dataset']['path']}` · {results['dataset']['rows']:,} rows · "
        f"{results['dataset']['traces']} traces · chronological 60/20/20 split",
        "",
        "## Forecast accuracy",
        "",
        "| Model | MAE | RMSE |",
        "|---|---:|---:|",
    ]
    for name, metrics in results["forecasting"].items():
        lines.append(f"| {name} | {metrics['mae']:.4f} | {metrics['rmse']:.4f} |")
    lines.extend([
        "",
        "## Imminent-breach classification",
        "",
        "A positive label means memory reaches its configured limit within the next 10 seconds.",
        "",
        "| Method | Precision | Recall | F1 | PR-AUC | False-alert rate | Event recall | Mean warning |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for name, metrics in results["classification"].items():
        lead = metrics["lead_time"]
        lines.append(
            f"| {name} | {metrics['precision']:.3f} | {metrics['recall']:.3f} | "
            f"{metrics['f1']:.3f} | {metrics['pr_auc']:.3f} | {metrics['false_alert_rate']:.3f} | "
            f"{lead['event_recall']:.3f} | {lead['mean_warning_seconds']:.2f}s |"
        )
    lines.extend([
        "",
        "These results use deterministic synthetic workload traces for regression testing. They are not a production-cluster claim.",
        "",
    ])
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate KubePulse against reproducible baselines")
    parser.add_argument("--dataset", type=Path, default=Path("data/kubepulse_benchmark.csv"))
    parser.add_argument("--model-dir", type=Path, default=Path("models/v2"))
    parser.add_argument("--output", type=Path, default=Path("benchmarks/results/latest.json"))
    parser.add_argument("--window-size", type=int, default=10)
    parser.add_argument("--horizon", type=int, default=10)
    args = parser.parse_args()

    traces = load_traces(args.dataset)
    split = build_splits(traces, args.window_size, args.horizon)["test"]
    lstm = tf.keras.models.load_model(args.model_dir / "lstm.keras")
    classifier = joblib.load(args.model_dir / "lightgbm.pkl")
    metadata = json.loads((args.model_dir / "metadata.json").read_text())
    lstm_forecast = split.current_ratio + lstm.predict(split.windows, verbose=0).reshape(-1)
    hybrid_score = classifier.predict_proba(classifier_features(split.windows, lstm_forecast))[:, 1]
    hybrid_threshold = float(metadata["decision_threshold"])

    forecasts = {
        "persistence": split.current_ratio,
        "moving_average_5": split.windows[:, -5:, 0].mean(axis=1),
        "linear_trend_5": linear_forecast(split.windows),
        "lstm_v2": lstm_forecast,
    }
    classification_inputs = {
        "static_threshold_0.85": (split.current_ratio >= 0.85, split.current_ratio),
        "prometheus_0.90_for_3": (np.all(split.windows[:, -3:, 0] >= 0.90, axis=1), split.windows[:, -3:, 0].min(axis=1)),
        "linear_trend_5": (forecasts["linear_trend_5"] >= 0.90, forecasts["linear_trend_5"]),
        "hybrid_lstm_lightgbm_v2": (hybrid_score >= hybrid_threshold, hybrid_score),
    }

    classification = {}
    for name, (predicted, score) in classification_inputs.items():
        predicted = predicted.astype(np.int32)
        metrics = classification_metrics(split.anomaly, predicted, np.asarray(score))
        metrics["lead_time"] = lead_time_metrics(split, predicted, args.horizon)
        classification[name] = metrics

    results = {
        "benchmark_version": "1.0",
        "environment": {"python": platform.python_version(), "platform": platform.platform()},
        "dataset": {
            "path": str(args.dataset),
            "rows": int(sum(len(values) for values in traces.values())),
            "traces": len(traces),
            "test_examples": int(len(split.anomaly)),
            "positive_test_examples": int(np.sum(split.anomaly)),
        },
        "forecasting": {name: forecast_metrics(split.next_ratio, values) for name, values in forecasts.items()},
        "classification": classification,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    write_markdown(results, args.output.with_suffix(".md"))
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
