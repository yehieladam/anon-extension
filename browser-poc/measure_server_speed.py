"""Speed measurement for the NEW server NER engine (int8 ONNX via src/analyze.py).

Builds a 20-line and a 60-line Hebrew doc (a realistic sentence with a person,
organizations and places, repeated), warms the pipeline up once, then times
analyze_text(doc) — median of 3 runs per size. Real measurement, nothing mocked.

Run from the repo root with the venv active:
    venv\\Scripts\\activate
    python browser-poc\\measure_server_speed.py
"""
import statistics
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from analyze import analyze_text, warm_up  # noqa: E402

SENTENCE = "דוד כהן ממשרד האוצר בירושלים שלח מכתב לרחל לוי מחברת אינטל בחיפה."
RUNS = 3


def build_doc(n_lines: int) -> str:
    return "\n".join(SENTENCE for _ in range(n_lines))


def time_doc(doc: str) -> list:
    times = []
    for _ in range(RUNS):
        t0 = time.perf_counter()
        results = analyze_text(doc)
        times.append(time.perf_counter() - t0)
        # sanity: real detections must come back, otherwise the timing is meaningless
        assert results, "analyze_text returned no detections — timing invalid"
    return times


def main() -> None:
    print("Warming up (loads the ONNX int8 pipeline)...")
    t0 = time.perf_counter()
    warm_up()
    print(f"Warm-up done in {time.perf_counter() - t0:.1f}s\n")

    for n in (20, 60):
        doc = build_doc(n)
        times = time_doc(doc)
        med = statistics.median(times)
        runs = ", ".join(f"{t:.2f}" for t in times)
        print(f"{n}-line doc: median {med:.2f}s  (runs: {runs}s)  "
              f"= {med / n * 1000:.0f} ms/line")


if __name__ == "__main__":
    main()
