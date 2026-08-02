"""Server-side NER baseline for the browser PoC.

Runs the CURRENT production pipeline (src/analyze.py -> analyze_text, which includes
the dictabert-ner recognizer) on the hand-labeled sentences in ner_testset.json,
keeps only the NER entity types (PERSON / ORGANIZATION / LOCATION), and measures
recall per type against the gold spans. Results are saved to server_baseline.json
so a future in-browser (ONNX) run can be compared against the same gold set.

Run from the repo root with the project venv active:
    venv\\Scripts\\activate
    python browser-poc\\run_server_baseline.py

Real detection only: every span below comes from the live model. Nothing is mocked.
"""
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

# Make Hebrew printable on the Windows console regardless of code page.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from analyze import analyze_text  # noqa: E402  (path inserted above)

NER_TYPES = ("PERSON", "ORGANIZATION", "LOCATION")

# Punctuation/whitespace stripped from span edges before comparison, so that e.g.
# a trailing comma or maqaf does not break a match.
_EDGE_CHARS = " \t\"'`.,;:!?()[]{}־–—…«»״׳"


def _norm(text: str) -> str:
    return text.strip(_EDGE_CHARS).strip()


def _is_match(gold_text: str, detected_text: str) -> bool:
    """MATCH RULE (simple and honest): a gold span counts as detected when a detected
    span of the SAME entity type has overlapping surface text - i.e. after trimming
    edge punctuation, one string contains the other. This tolerates Hebrew prefix
    letters the model may absorb (detected "מקריית שמונה" matches gold "קריית שמונה")
    and longer detected spans (detected "בית החולים שיבא" matches gold "שיבא"),
    but a wrong type or a completely different string is a miss. No partial credit
    beyond containment, no fuzzy scoring."""
    g, d = _norm(gold_text), _norm(detected_text)
    return bool(g) and bool(d) and (g in d or d in g)


def main() -> None:
    testset_path = ROOT / "browser-poc" / "ner_testset.json"
    sentences = json.loads(testset_path.read_text(encoding="utf-8"))

    print(f"Loaded {len(sentences)} gold sentences from {testset_path.name}")
    print("Loading model + running analysis (first call loads dictabert, ~8s; "
          "first EVER run downloads ~500MB)...")
    t0 = time.time()

    per_sentence = []
    gold_total = defaultdict(int)
    gold_hit = defaultdict(int)

    for item in sentences:
        text = item["text"]
        results = analyze_text(text)
        detected = [
            {
                "text": text[r.start:r.end],
                "type": r.entity_type,
                "start": r.start,
                "end": r.end,
                "score": round(float(r.score), 4),
            }
            for r in results
            if r.entity_type in NER_TYPES
        ]

        gold_eval = []
        for gold in item["gold"]:
            gtype = gold["type"]
            gold_total[gtype] += 1
            matched = any(
                d["type"] == gtype and _is_match(gold["text"], d["text"])
                for d in detected
            )
            if matched:
                gold_hit[gtype] += 1
            gold_eval.append({"text": gold["text"], "type": gtype, "detected": matched})

        per_sentence.append({"text": text, "gold": gold_eval, "detected": detected})

    elapsed = time.time() - t0

    recall = {}
    for etype in NER_TYPES:
        total, hit = gold_total[etype], gold_hit[etype]
        recall[etype] = {
            "detected": hit,
            "total": total,
            "recall": round(hit / total, 4) if total else None,
        }
    all_total = sum(gold_total.values())
    all_hit = sum(gold_hit.values())
    recall["overall"] = {
        "detected": all_hit,
        "total": all_total,
        "recall": round(all_hit / all_total, 4) if all_total else None,
    }

    # ---- report ----
    print(f"\nAnalysis done in {elapsed:.1f}s\n")
    header = f"{'TYPE':<14}{'DETECTED':>9}{'GOLD':>6}{'RECALL':>9}"
    print(header)
    print("-" * len(header))
    for etype in NER_TYPES:
        r = recall[etype]
        print(f"{etype:<14}{r['detected']:>9}{r['total']:>6}{r['recall']:>9.2%}")
    r = recall["overall"]
    print("-" * len(header))
    print(f"{'OVERALL':<14}{r['detected']:>9}{r['total']:>6}{r['recall']:>9.2%}")

    misses = [
        (s["text"], g)
        for s in per_sentence
        for g in s["gold"]
        if not g["detected"]
    ]
    if misses:
        print("\nMissed gold spans:")
        for sent_text, g in misses:
            print(f"  [{g['type']}] '{g['text']}'  in: {sent_text}")

    out_path = ROOT / "browser-poc" / "server_baseline.json"
    out_path.write_text(
        json.dumps(
            {
                "model": "dicta-il/dictabert-ner (server, via src/analyze.py analyze_text)",
                "match_rule": "same entity type + containment of normalized surface text "
                              "(edge punctuation stripped); see _is_match docstring",
                "elapsed_seconds": round(elapsed, 1),
                "sentences": per_sentence,
                "recall": recall,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nSaved full results to {out_path}")


if __name__ == "__main__":
    main()
