from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class DatasetSplit:
    windows: np.ndarray
    next_ratio: np.ndarray
    anomaly: np.ndarray
    trace_ids: np.ndarray
    timestamps: np.ndarray
    current_ratio: np.ndarray


def load_traces(path: Path) -> dict[str, np.ndarray]:
    traces: dict[str, list[float]] = defaultdict(list)
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            traces[row["trace_id"]].append(float(row["memory_ratio"]))
    return {trace_id: np.asarray(values, dtype=np.float32) for trace_id, values in traces.items()}


def build_splits(
    traces: dict[str, np.ndarray],
    window_size: int = 10,
    horizon: int = 10,
) -> dict[str, DatasetSplit]:
    buckets: dict[str, dict[str, list]] = {
        split: defaultdict(list) for split in ("train", "validation", "test")
    }
    for trace_id, values in sorted(traces.items()):
        length = len(values)
        for target_index in range(window_size, length - horizon):
            fraction = target_index / length
            split = "train" if fraction < 0.60 else "validation" if fraction < 0.80 else "test"
            future = values[target_index : target_index + horizon]
            bucket = buckets[split]
            bucket["windows"].append(values[target_index - window_size : target_index])
            bucket["next_ratio"].append(values[target_index])
            bucket["anomaly"].append(int(np.max(future) >= 1.0))
            bucket["trace_ids"].append(trace_id)
            bucket["timestamps"].append(target_index)
            bucket["current_ratio"].append(values[target_index - 1])

    result = {}
    for split, bucket in buckets.items():
        result[split] = DatasetSplit(
            windows=np.asarray(bucket["windows"], dtype=np.float32)[..., np.newaxis],
            next_ratio=np.asarray(bucket["next_ratio"], dtype=np.float32),
            anomaly=np.asarray(bucket["anomaly"], dtype=np.int32),
            trace_ids=np.asarray(bucket["trace_ids"]),
            timestamps=np.asarray(bucket["timestamps"], dtype=np.int32),
            current_ratio=np.asarray(bucket["current_ratio"], dtype=np.float32),
        )
    return result
