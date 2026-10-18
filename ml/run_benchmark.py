from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def run(*arguments: str) -> None:
    subprocess.run([sys.executable, *arguments], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate, train, and evaluate KubePulse v2")
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--skip-training", action="store_true")
    args = parser.parse_args()

    dataset = Path("data/kubepulse_benchmark.csv")
    run("-m", "ml.generate_dataset", "--output", str(dataset))
    if not args.skip_training:
        run("-m", "ml.train", "--dataset", str(dataset), "--epochs", str(args.epochs))
    run("-m", "ml.evaluate", "--dataset", str(dataset))


if __name__ == "__main__":
    main()
