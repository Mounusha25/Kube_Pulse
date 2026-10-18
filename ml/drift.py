from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np


UPPER_BOUNDS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.25, 1.5, None]


def proportions(values: np.ndarray, upper_bounds: list[float | None] = UPPER_BOUNDS) -> list[float]:
    samples = np.asarray(values, dtype=np.float64).reshape(-1)
    if samples.size == 0 or not np.all(np.isfinite(samples)):
        raise ValueError("drift reference samples must be finite and non-empty")
    counts = np.zeros(len(upper_bounds), dtype=np.float64)
    for value in samples:
        index = next(
            (position for position, upper in enumerate(upper_bounds) if upper is None or value < upper),
            len(upper_bounds) - 1,
        )
        counts[index] += 1
    # Laplace smoothing prevents zero-probability bins from dominating PSI.
    smoothed = counts + 1.0
    return (smoothed / np.sum(smoothed)).tolist()


def population_stability_index(values: np.ndarray, feature: dict) -> float:
    samples = np.asarray(values, dtype=np.float64).reshape(-1)
    if samples.size == 0 or not np.all(np.isfinite(samples)):
        raise ValueError("PSI samples must be finite and non-empty")
    counts = np.zeros(len(feature["upper_bounds"]), dtype=np.float64)
    for value in samples:
        index = next(
            (
                position
                for position, upper in enumerate(feature["upper_bounds"])
                if upper is None or value < upper
            ),
            len(feature["upper_bounds"]) - 1,
        )
        counts[index] += 1
    actual = np.maximum(counts / samples.size, 1e-6)
    expected = np.maximum(np.asarray(feature["expected_proportions"], dtype=np.float64), 1e-6)
    return float(np.sum((actual - expected) * np.log(actual / expected)))


def calibrated_threshold(
    values: np.ndarray,
    trace_ids: np.ndarray,
    feature: dict,
    *,
    quantile: float = 0.95,
) -> tuple[float, list[float]]:
    scores = [
        population_stability_index(values[trace_ids == trace_id], feature)
        for trace_id in np.unique(trace_ids)
    ]
    if not scores:
        raise ValueError("calibration requires at least one trace")
    return float(max(0.2, np.quantile(scores, quantile))), scores


def build_reference(
    *,
    dataset_path: Path,
    input_values: np.ndarray,
    forecast_values: np.ndarray,
    calibration_input_values: np.ndarray | None = None,
    calibration_forecast_values: np.ndarray | None = None,
    calibration_trace_ids: np.ndarray | None = None,
    model_version: str = "v2",
) -> dict:
    memory_feature = {
        "sample_count": int(np.asarray(input_values).size),
        "upper_bounds": UPPER_BOUNDS,
        "expected_proportions": proportions(input_values),
    }
    prediction_feature = {
        "sample_count": int(np.asarray(forecast_values).size),
        "upper_bounds": UPPER_BOUNDS,
        "expected_proportions": proportions(forecast_values),
    }
    reference = {
        "schema_version": "1.0",
        "model_version": model_version,
        "dataset": {
            "path": str(dataset_path),
            "sha256": hashlib.sha256(dataset_path.read_bytes()).hexdigest(),
        },
        "method": "population_stability_index",
        "features": {
            "memory_ratio": memory_feature,
            "predicted_memory_ratio": prediction_feature,
        },
    }
    if calibration_trace_ids is not None:
        if calibration_input_values is None or calibration_forecast_values is None:
            raise ValueError("both calibration distributions are required")
        input_threshold, input_scores = calibrated_threshold(
            np.asarray(calibration_input_values), calibration_trace_ids, memory_feature
        )
        prediction_threshold, prediction_scores = calibrated_threshold(
            np.asarray(calibration_forecast_values), calibration_trace_ids, prediction_feature
        )
        reference["monitoring"] = {
            "calibration_split": "validation",
            "calibration_traces": int(len(np.unique(calibration_trace_ids))),
            "threshold_quantile": 0.95,
            "thresholds": {
                "memory_ratio": input_threshold,
                "predicted_memory_ratio": prediction_threshold,
            },
            "calibration_psi_summary": {
                "memory_ratio_max": max(input_scores),
                "predicted_memory_ratio_max": max(prediction_scores),
            },
        }
    return reference


def write_reference(reference: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(reference, indent=2) + "\n", encoding="utf-8")
