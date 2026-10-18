from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

import numpy as np


SCENARIOS = ("steady", "gradual_leak", "burst", "oscillating")


def trace_for(scenario: str, length: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    time = np.arange(length, dtype=np.float64)
    ratio = 0.42 + 0.035 * np.sin(time / 18.0 + seed) + rng.normal(0, 0.012, length)

    if scenario == "gradual_leak":
        for start in (80, 290, 470):
            if start >= length:
                continue
            duration = 85
            stop = min(start + duration, length)
            ratio[start:stop] += np.linspace(0, 0.78, stop - start)
            recovery_stop = min(stop + 20, length)
            ratio[stop:recovery_stop] += np.linspace(0.72, 0, recovery_stop - stop)
    elif scenario == "burst":
        for start in (120, 330, 505):
            if start >= length:
                continue
            duration = 18
            stop = min(start + duration, length)
            pulse = np.sin(np.linspace(0, math.pi, stop - start)) * 0.78
            ratio[start:stop] += pulse
    elif scenario == "oscillating":
        ratio += 0.16 * np.sin(time / 7.0)
        for start in (175, 390, 520):
            if start >= length:
                continue
            stop = min(start + 35, length)
            ratio[start:stop] += np.linspace(0.12, 0.62, stop - start)

    return np.clip(ratio, 0.05, 1.45)


def generate(output: Path, traces_per_scenario: int, length: int, seed: int) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=("trace_id", "scenario", "timestamp_s", "memory_ratio", "is_breach"),
        )
        writer.writeheader()
        for scenario_index, scenario in enumerate(SCENARIOS):
            for replicate in range(traces_per_scenario):
                trace_id = f"{scenario}-{replicate:02d}"
                values = trace_for(scenario, length, seed + scenario_index * 100 + replicate)
                for timestamp, value in enumerate(values):
                    writer.writerow(
                        {
                            "trace_id": trace_id,
                            "scenario": scenario,
                            "timestamp_s": timestamp,
                            "memory_ratio": f"{value:.8f}",
                            "is_breach": int(value >= 1.0),
                        }
                    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic KubePulse benchmark traces")
    parser.add_argument("--output", type=Path, default=Path("data/kubepulse_benchmark.csv"))
    parser.add_argument("--traces-per-scenario", type=int, default=6)
    parser.add_argument("--length", type=int, default=600)
    parser.add_argument("--seed", type=int, default=20261018)
    args = parser.parse_args()
    generate(args.output, args.traces_per_scenario, args.length, args.seed)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
