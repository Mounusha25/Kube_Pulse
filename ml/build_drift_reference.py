from __future__ import annotations

import argparse
import json
from pathlib import Path

import tensorflow as tf

from ml.dataset import build_splits, load_traces
from ml.drift import build_reference, write_reference


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the versioned KubePulse drift reference")
    parser.add_argument("--dataset", type=Path, default=Path("data/kubepulse_benchmark.csv"))
    parser.add_argument("--model-dir", type=Path, default=Path("models/v2"))
    parser.add_argument("--output", type=Path, default=Path("models/v2/drift_reference.json"))
    args = parser.parse_args()

    metadata = json.loads((args.model_dir / "metadata.json").read_text(encoding="utf-8"))
    window_size = int(metadata["window_size"])
    horizon = int(metadata["horizon_seconds"])
    splits = build_splits(load_traces(args.dataset), window_size, horizon)
    train = splits["train"]
    validation = splits["validation"]
    model = tf.keras.models.load_model(args.model_dir / "lstm.keras")
    forecasts = train.current_ratio + model.predict(train.windows, verbose=0).reshape(-1)
    validation_forecasts = validation.current_ratio + model.predict(validation.windows, verbose=0).reshape(-1)
    reference = build_reference(
        dataset_path=args.dataset,
        input_values=train.current_ratio,
        forecast_values=forecasts,
        calibration_input_values=validation.current_ratio,
        calibration_forecast_values=validation_forecasts,
        calibration_trace_ids=validation.trace_ids,
        model_version="v2",
    )
    write_reference(reference, args.output)
    print(json.dumps(reference, indent=2))


if __name__ == "__main__":
    main()
