from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np

from ml.drift import population_stability_index


def load_live(path: Path) -> dict[str, np.ndarray]:
    columns: dict[str, list[float]] = {
        "memory_ratio": [],
        "predicted_memory_ratio": [],
    }
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            for name in columns:
                columns[name].append(float(row[name]))
    return {name: np.asarray(values, dtype=np.float64) for name, values in columns.items()}


def write_markdown(result: dict, path: Path) -> None:
    lines = [
        "# KubePulse drift report",
        "",
        f"Reference model: `{result['model_version']}` · live rows: {result['live_rows']}",
        "",
        "| Distribution | PSI | Threshold | Drifted |",
        "|---|---:|---:|---:|",
    ]
    for name, metrics in result["distributions"].items():
        lines.append(
            f"| {name} | {metrics['psi']:.4f} | {metrics['threshold']:.4f} | "
            f"{'yes' if metrics['drifted'] else 'no'} |"
        )
    lines.extend([
        "",
        f"Overall drift: **{'detected' if result['drift_detected'] else 'not detected'}**.",
        "",
        "A drift result recommends review; it does not automatically replace the deployed model.",
        "",
    ])
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare live KubePulse distributions with the versioned reference")
    parser.add_argument("--live", type=Path, required=True, help="CSV with memory_ratio and predicted_memory_ratio")
    parser.add_argument("--reference", type=Path, default=Path("models/v2/drift_reference.json"))
    parser.add_argument("--threshold", type=float, default=None, help="Optional override applied to both distributions")
    parser.add_argument("--output", type=Path, default=Path("drift-report.json"))
    args = parser.parse_args()
    if args.threshold is not None and args.threshold <= 0:
        parser.error("threshold must be positive")

    reference = json.loads(args.reference.read_text(encoding="utf-8"))
    thresholds = reference.get("monitoring", {}).get("thresholds")
    if args.threshold is not None:
        thresholds = {"memory_ratio": args.threshold, "predicted_memory_ratio": args.threshold}
    if not thresholds:
        parser.error("reference has no calibrated thresholds; pass --threshold")
    live = load_live(args.live)
    if len(live["memory_ratio"]) == 0:
        parser.error("live CSV contains no rows")
    distributions = {}
    for name, values in live.items():
        psi = population_stability_index(values, reference["features"][name])
        distributions[name] = {"psi": psi, "threshold": thresholds[name], "drifted": psi >= thresholds[name]}
    result = {
        "schema_version": "1.0",
        "model_version": reference["model_version"],
        "reference_dataset_sha256": reference["dataset"]["sha256"],
        "live_path": str(args.live),
        "live_rows": len(live["memory_ratio"]),
        "thresholds": thresholds,
        "distributions": distributions,
        "drift_detected": any(item["drifted"] for item in distributions.values()),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    write_markdown(result, args.output.with_suffix(".md"))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
