"""Persistent JSON-lines inference process for the KubePulse v2 hybrid model."""

from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path

import joblib
import numpy as np

os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
import tensorflow as tf  # noqa: E402

from ml.features import classifier_features  # noqa: E402


ROOT = Path(__file__).resolve().parent
MODEL_DIR = Path(os.getenv("KUBEPULSE_MODEL_DIR", ROOT / "models" / "v2"))
LSTM_PATH = Path(os.getenv("KUBEPULSE_LSTM_MODEL", MODEL_DIR / "lstm.keras"))
LIGHTGBM_PATH = Path(os.getenv("KUBEPULSE_LIGHTGBM_MODEL", MODEL_DIR / "lightgbm.pkl"))
METADATA_PATH = Path(os.getenv("KUBEPULSE_MODEL_METADATA", MODEL_DIR / "metadata.json"))

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
lstm_model = tf.keras.models.load_model(LSTM_PATH)
classifier = joblib.load(LIGHTGBM_PATH)
metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
window_size = int(metadata["window_size"])
decision_threshold = float(metadata["decision_threshold"])


def predict(memory_usage: list[float]) -> dict[str, float | int]:
    if len(memory_usage) != window_size:
        raise ValueError(f"expected {window_size} memory samples, received {len(memory_usage)}")
    window = np.asarray(memory_usage, dtype=np.float32).reshape(1, window_size, 1)
    predicted_delta = float(lstm_model.predict(window, verbose=0)[0][0])
    predicted_memory = float(window[0, -1, 0] + predicted_delta)
    features = classifier_features(window, np.asarray([predicted_memory], dtype=np.float32))
    anomaly_score = float(classifier.predict_proba(features)[0, 1])
    return {
        "predictedMemory": predicted_memory,
        "anomalyScore": anomaly_score,
        "isAnomaly": int(anomaly_score >= decision_threshold),
    }


for raw_line in sys.stdin:
    try:
        payload = json.loads(raw_line)
        print(json.dumps(predict(payload["memoryUsage"])), flush=True)
    except Exception as error:
        print(f"Prediction error: {error}", file=sys.stderr, flush=True)
