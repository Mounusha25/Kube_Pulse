from __future__ import annotations

import numpy as np


def linear_forecast(windows: np.ndarray) -> np.ndarray:
    values = windows[:, -5:, 0]
    x = np.arange(5, dtype=np.float32)
    centered = x - np.mean(x)
    slopes = np.sum((values - values.mean(axis=1, keepdims=True)) * centered, axis=1) / np.sum(centered**2)
    return values[:, -1] + slopes


def classifier_features(windows: np.ndarray, lstm_forecast: np.ndarray) -> np.ndarray:
    values = windows[:, :, 0]
    recent = values[:, -5:]
    slope_forecast = linear_forecast(windows)
    return np.column_stack(
        [
            lstm_forecast,
            values[:, -1],
            slope_forecast,
            recent.mean(axis=1),
            recent.std(axis=1),
            recent.max(axis=1),
            values[:, -1] - values[:, -2],
        ]
    ).astype(np.float32)


def best_f1_threshold(actual: np.ndarray, scores: np.ndarray) -> float:
    best_threshold = 0.5
    best_f1 = -1.0
    for threshold in np.linspace(0.05, 0.95, 181):
        predicted = scores >= threshold
        tp = np.sum((predicted == 1) & (actual == 1))
        fp = np.sum((predicted == 1) & (actual == 0))
        fn = np.sum((predicted == 0) & (actual == 1))
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        if f1 > best_f1:
            best_f1 = f1
            best_threshold = float(threshold)
    return best_threshold
