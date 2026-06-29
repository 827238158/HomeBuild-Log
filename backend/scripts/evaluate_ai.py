from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import httpx

from app.ai_adapter import PROMPT_VERSION, OpenAICompatibleAdapter
from app.core.config import SecretsConfig
from app.core.paths import get_storage_paths

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GOLDEN_DIR = ROOT / "docs" / "samples" / "ai-evaluation"
MONEY_FIELDS = {"amount_minor", "order_total_minor"}


def _matches(payload: dict[str, Any], expected: dict[str, Any]) -> bool:
    return all(payload.get(key) == value for key, value in expected.items())


def _score_sample(sample: dict[str, Any], draft) -> dict[str, Any]:
    golden_records = sample["records"]
    unmatched = set(range(len(golden_records)))
    matched_by_ref: dict[str, dict[str, Any]] = {}
    unmatched_predictions: list[dict[str, Any]] = []
    explicit_violations: list[str] = []
    money_total = 0
    money_correct = 0

    for candidate in draft.suggestions:
        matched_index = next(
            (
                index
                for index in unmatched
                if golden_records[index]["record_type"] == candidate.record_type
                and _matches(candidate.payload, golden_records[index].get("match", {}))
            ),
            None,
        )
        if matched_index is None:
            unmatched_predictions.append(candidate.model_dump())
            if candidate.certainty == "explicit":
                explicit_violations.append(candidate.ref)
            continue
        unmatched.remove(matched_index)
        golden = golden_records[matched_index]
        matched_by_ref[candidate.ref] = golden
        if candidate.certainty == "explicit" and golden["certainty"] != "explicit":
            explicit_violations.append(candidate.ref)
        for field in MONEY_FIELDS:
            if field in golden.get("match", {}):
                money_total += 1
                money_correct += candidate.payload.get(field) == golden["match"][field]

    golden_relations = {
        (item["from"], item["to"], item["relation_type"])
        for item in sample.get("relations", [])
    }
    predicted_relations: set[tuple[str, str, str]] = set()
    for relation in draft.relations:
        from_golden = matched_by_ref.get(relation.from_ref)
        to_golden = matched_by_ref.get(relation.to_ref)
        if from_golden and to_golden:
            predicted_relations.add(
                (
                    from_golden["golden_id"],
                    to_golden["golden_id"],
                    relation.relation_type,
                )
            )

    forbidden = set(sample.get("forbidden_record_types", []))
    forbidden_hits = [
        item.ref for item in draft.suggestions if item.record_type in forbidden
    ]
    return {
        "sample_id": sample["sample_id"],
        "true_positive": len(matched_by_ref),
        "predicted": len(draft.suggestions),
        "golden": len(golden_records),
        "relation_true_positive": len(predicted_relations & golden_relations),
        "relation_predicted": len(draft.relations),
        "relation_golden": len(golden_relations),
        "money_correct": money_correct,
        "money_total": money_total,
        "explicit_violations": explicit_violations,
        "forbidden_hits": forbidden_hits,
        "missing_golden_ids": [golden_records[index]["golden_id"] for index in unmatched],
        "unmatched_predictions": unmatched_predictions,
        "warnings": draft.warnings,
    }


def _ratio(numerator: int, denominator: int) -> float:
    return 1.0 if denominator == 0 else numerator / denominator


def main() -> int:
    parser = argparse.ArgumentParser(description="运行 HomeBuild Log 文本 AI 黄金样本评测。")
    parser.add_argument("--provider", choices=["deepseek", "mimo"], required=True)
    parser.add_argument("--golden-dir", type=Path, default=DEFAULT_GOLDEN_DIR)
    parser.add_argument("--config-dir", type=Path, default=get_storage_paths().config)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    config = SecretsConfig(args.config_dir).get_ai_config()
    provider = config.providers.get(args.provider)
    if provider is None or not provider.api_key:
        print(f"缺少 {args.provider.upper()}_API_KEY 或 secrets.json API Key。", file=sys.stderr)
        return 2

    sample_paths = sorted(args.golden_dir.glob("[0-9][0-9][0-9].json"))
    if not sample_paths:
        print("未找到黄金样本。", file=sys.stderr)
        return 2

    results: list[dict[str, Any]] = []
    with httpx.Client(trust_env=False) as client:
        adapter = OpenAICompatibleAdapter(
            provider,
            temperature=config.temperature,
            client=client,
        )
        for path in sample_paths:
            sample = json.loads(path.read_text(encoding="utf-8"))
            # 每条样本独立调用，避免跨来源上下文污染提取结果。
            response = adapter.extract_from_text(sample["text"], config.timeout_seconds)
            result = _score_sample(sample, response.draft)
            result["usage"] = {
                "prompt_tokens": response.prompt_tokens,
                "completion_tokens": response.completion_tokens,
                "total_tokens": response.total_tokens,
                "duration_ms": response.duration_ms,
            }
            results.append(result)

    totals = {
        key: sum(item[key] for item in results)
        for key in [
            "true_positive",
            "predicted",
            "golden",
            "relation_true_positive",
            "relation_predicted",
            "relation_golden",
            "money_correct",
            "money_total",
        ]
    }
    metrics = {
        "precision": _ratio(totals["true_positive"], totals["predicted"]),
        "recall": _ratio(totals["true_positive"], totals["golden"]),
        "relation_accuracy": _ratio(
            totals["relation_true_positive"],
            max(totals["relation_predicted"], totals["relation_golden"]),
        ),
        "money_accuracy": _ratio(totals["money_correct"], totals["money_total"]),
        "explicit_violations": sum(len(item["explicit_violations"]) for item in results),
        "forbidden_hits": sum(len(item["forbidden_hits"]) for item in results),
    }
    passed = (
        metrics["precision"] >= 0.9
        and metrics["recall"] >= 0.9
        and metrics["relation_accuracy"] >= 0.9
        and metrics["money_accuracy"] == 1
        and metrics["explicit_violations"] == 0
        and metrics["forbidden_hits"] == 0
    )
    report = {
        "provider": provider.name,
        "model": provider.model,
        "prompt_version": PROMPT_VERSION,
        "passed": passed,
        "metrics": metrics,
        "samples": results,
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
