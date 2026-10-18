from __future__ import annotations

import argparse
import json
import os
import random
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import tensorflow as tf

from ml.dataset import build_splits, load_traces
from ml.features import best_f1_threshold, classifier_features


def set_seeds(seed: int) -> None:
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    tf.random.set_seed(seed)


def build_model(window_size: int) -> tf.keras.Model:
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(window_size, 1)),
            tf.keras.layers.LSTM(32),
            tf.keras.layers.Dense(16, activation="relu"),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(1),
        ]
    )
    model.compile(optimizer="adam", loss="mse", metrics=["mae"])
    return model


def main() -> None:
    parser = argparse.ArgumentParser(description="Train reproducible KubePulse hybrid models")
    parser.add_argument("--dataset", type=Path, default=Path("data/kubepulse_benchmark.csv"))
    parser.add_argument("--output-dir", type=Path, default=Path("models/v2"))
    parser.add_argument("--window-size", type=int, default=10)
    parser.add_argument("--horizon", type=int, default=10)
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--seed", type=int, default=20261018)
    args = parser.parse_args()

    set_seeds(args.seed)
    splits = build_splits(load_traces(args.dataset), args.window_size, args.horizon)
    train = splits["train"]
    validation = splits["validation"]

    model = build_model(args.window_size)
    history = model.fit(
        train.windows,
        train.next_ratio - train.current_ratio,
        validation_data=(validation.windows, validation.next_ratio - validation.current_ratio),
        epochs=args.epochs,
        batch_size=128,
        verbose=0,
        callbacks=[tf.keras.callbacks.EarlyStopping(patience=4, restore_best_weights=True)],
    )
    train_forecast = train.current_ratio + model.predict(train.windows, verbose=0).reshape(-1)
    validation_forecast = validation.current_ratio + model.predict(validation.windows, verbose=0).reshape(-1)
    classifier = lgb.LGBMClassifier(
        n_estimators=120,
        learning_rate=0.05,
        num_leaves=15,
        class_weight="balanced",
        random_state=args.seed,
        verbosity=-1,
    )
    classifier.fit(classifier_features(train.windows, train_forecast), train.anomaly)
    validation_scores = classifier.predict_proba(
        classifier_features(validation.windows, validation_forecast)
    )[:, 1]
    decision_threshold = best_f1_threshold(validation.anomaly, validation_scores)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    model.save(args.output_dir / "lstm.keras")
    joblib.dump(classifier, args.output_dir / "lightgbm.pkl")
    metadata = {
        "seed": args.seed,
        "window_size": args.window_size,
        "horizon_seconds": args.horizon,
        "forecast_target": "next_ratio_delta",
        "classifier_features": [
            "lstm_forecast", "current_ratio", "linear_forecast_5", "mean_5",
            "std_5", "max_5", "last_delta",
        ],
        "decision_threshold": decision_threshold,
        "train_examples": int(len(train.anomaly)),
        "validation_examples": int(len(validation.anomaly)),
        "epochs_completed": len(history.history["loss"]),
        "final_train_mae": float(history.history["mae"][-1]),
        "final_validation_mae": float(history.history["val_mae"][-1]),
    }
    (args.output_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
