from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Enforce KubePulse benchmark quality gates")
    parser.add_argument("--results", type=Path, default=Path("benchmarks/results/latest.json"))
    parser.add_argument("--min-f1", type=float, default=0.80)
    parser.add_argument("--min-event-recall", type=float, default=0.95)
    parser.add_argument("--max-false-alert-rate", type=float, default=0.04)
    args = parser.parse_args()

    results = json.loads(args.results.read_text(encoding="utf-8"))
    hybrid = results["classification"]["hybrid_lstm_lightgbm_v2"]
    failures = []
    if hybrid["f1"] < args.min_f1:
        failures.append(f"F1 {hybrid['f1']:.4f} < {args.min_f1:.4f}")
    if hybrid["lead_time"]["event_recall"] < args.min_event_recall:
        failures.append(
            f"event recall {hybrid['lead_time']['event_recall']:.4f} < {args.min_event_recall:.4f}"
        )
    if hybrid["false_alert_rate"] > args.max_false_alert_rate:
        failures.append(
            f"false-alert rate {hybrid['false_alert_rate']:.4f} > {args.max_false_alert_rate:.4f}"
        )
    if results["forecasting"]["lstm_v2"]["mae"] >= results["forecasting"]["persistence"]["mae"]:
        failures.append("LSTM MAE does not beat persistence")
    if failures:
        raise SystemExit("Benchmark quality gate failed:\n- " + "\n- ".join(failures))
    print("Benchmark quality gate passed")


if __name__ == "__main__":
    main()
