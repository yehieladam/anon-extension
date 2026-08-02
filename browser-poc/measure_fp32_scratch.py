"""Scratch-only fp32 timing reference — does NOT touch src/ or the production engine.

Loads the OLD torch fp32 model (dicta-il/dictabert-ner, still in the HF cache) through
the same HuggingFace token-classification pipeline call pattern the production
recognizer uses (batched list of lines, aggregation_strategy="simple"), and times the
same 20-line and 60-line docs used by measure_server_speed.py. This yields an
apples-to-apples OLD-vs-NEW ratio on THIS machine. For fairness it also times the
NEW int8 ONNX pipeline at the same bare-pipeline level (no Presidio/regex overhead
in either number).

Run from the repo root with the venv active:
    python browser-poc\\measure_fp32_scratch.py
"""
import statistics
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SENTENCE = "דוד כהן ממשרד האוצר בירושלים שלח מכתב לרחל לוי מחברת אינטל בחיפה."
RUNS = 3


def time_pipeline(pipe, lines) -> float:
    times = []
    for _ in range(RUNS):
        t0 = time.perf_counter()
        out = pipe(lines)
        times.append(time.perf_counter() - t0)
        assert out and any(out), "pipeline returned nothing — timing invalid"
    return times


def report(label: str, pipe) -> None:
    for n in (20, 60):
        lines = [SENTENCE] * n
        times = time_pipeline(pipe, lines)
        med = statistics.median(times)
        runs = ", ".join(f"{t:.2f}" for t in times)
        print(f"  {label} {n}-line: median {med:.2f}s (runs: {runs}s) "
              f"= {med / n * 1000:.0f} ms/line")


def main() -> None:
    from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline

    print("Loading OLD fp32 torch model (dicta-il/dictabert-ner, from cache)...")
    t0 = time.perf_counter()
    fp32_model = AutoModelForTokenClassification.from_pretrained("dicta-il/dictabert-ner")
    fp32_tok = AutoTokenizer.from_pretrained("dicta-il/dictabert-ner")
    fp32_pipe = pipeline(
        "token-classification", model=fp32_model, tokenizer=fp32_tok,
        aggregation_strategy="simple", device=-1,
    )
    print(f"  loaded in {time.perf_counter() - t0:.1f}s")
    # warm-up
    fp32_pipe([SENTENCE])
    report("fp32 torch (all cores)", fp32_pipe)

    # Matched-resources run: production ONNX is capped at 2 intra-op threads
    # (src/recognizers/dicta_ner.py), so also time torch at 2 threads — this is
    # the number that predicts the 2-core VPS.
    import torch
    torch.set_num_threads(2)
    report("fp32 torch (2 threads)", fp32_pipe)

    print("\nLoading NEW int8 ONNX model (onnx-community/dictabert-ner-ONNX)...")
    import onnxruntime
    from optimum.onnxruntime import ORTModelForTokenClassification

    so = onnxruntime.SessionOptions()
    so.intra_op_num_threads = 2  # same cap as production (src/recognizers/dicta_ner.py)
    so.inter_op_num_threads = 1
    t0 = time.perf_counter()
    q8_model = ORTModelForTokenClassification.from_pretrained(
        "onnx-community/dictabert-ner-ONNX",
        file_name="model_quantized.onnx",
        provider="CPUExecutionProvider",
        session_options=so,
    )
    q8_tok = AutoTokenizer.from_pretrained("onnx-community/dictabert-ner-ONNX")
    q8_pipe = pipeline(
        "token-classification", model=q8_model, tokenizer=q8_tok,
        aggregation_strategy="simple",
    )
    print(f"  loaded in {time.perf_counter() - t0:.1f}s")
    q8_pipe([SENTENCE])
    report("int8 onnx (2-thread cap)", q8_pipe)


if __name__ == "__main__":
    main()
