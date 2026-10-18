from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from ml.dataset import build_splits, load_traces
from ml.features import classifier_features
from ml.generate_dataset import generate


class BenchmarkDatasetTests(unittest.TestCase):
    def test_generation_is_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.csv"
            second = Path(directory) / "second.csv"
            generate(first, traces_per_scenario=1, length=100, seed=7)
            generate(second, traces_per_scenario=1, length=100, seed=7)
            self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_chronological_splits_do_not_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dataset = Path(directory) / "benchmark.csv"
            generate(dataset, traces_per_scenario=1, length=200, seed=11)
            splits = build_splits(load_traces(dataset), window_size=10, horizon=10)
            for trace_id in np.unique(splits["train"].trace_ids):
                train_times = splits["train"].timestamps[splits["train"].trace_ids == trace_id]
                validation_times = splits["validation"].timestamps[splits["validation"].trace_ids == trace_id]
                test_times = splits["test"].timestamps[splits["test"].trace_ids == trace_id]
                self.assertLess(np.max(train_times), np.min(validation_times))
                self.assertLess(np.max(validation_times), np.min(test_times))

    def test_classifier_feature_shape_is_stable(self) -> None:
        windows = np.linspace(0.3, 0.9, 30, dtype=np.float32).reshape(3, 10, 1)
        forecast = np.asarray([0.91, 0.92, 0.93], dtype=np.float32)
        features = classifier_features(windows, forecast)
        self.assertEqual(features.shape, (3, 7))
        self.assertTrue(np.all(np.isfinite(features)))


if __name__ == "__main__":
    unittest.main()
