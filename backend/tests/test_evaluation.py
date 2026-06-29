from __future__ import annotations

from app.ai_adapter import AIExtractionDraft
from scripts.evaluate_ai import _score_sample


def test_evaluation_scores_records_money_relations_and_explicit_purity() -> None:
    sample = {
        "sample_id": "test",
        "records": [
            {
                "golden_id": "ledger-1",
                "record_type": "ledger",
                "certainty": "explicit",
                "match": {"amount_minor": 50000},
            },
            {
                "golden_id": "procurement-1",
                "record_type": "procurement",
                "certainty": "explicit",
                "match": {"order_total_minor": 110000},
            },
        ],
        "relations": [
            {
                "from": "ledger-1",
                "to": "procurement-1",
                "relation_type": "pays_for",
            }
        ],
    }
    draft = AIExtractionDraft.model_validate(
        {
            "suggestions": [
                {
                    "ref": "l1",
                    "record_type": "ledger",
                    "summary": "预付款",
                    "evidence": "已交500元",
                    "certainty": "explicit",
                    "payload": {"amount_minor": 50000},
                },
                {
                    "ref": "p1",
                    "record_type": "procurement",
                    "summary": "花砖订单",
                    "evidence": "共计1100元",
                    "certainty": "explicit",
                    "payload": {"order_total_minor": 110000},
                },
            ],
            "relations": [
                {"from_ref": "l1", "to_ref": "p1", "relation_type": "pays_for"}
            ],
        }
    )

    result = _score_sample(sample, draft)

    assert result["true_positive"] == 2
    assert result["money_correct"] == result["money_total"] == 2
    assert result["relation_true_positive"] == 1
    assert result["explicit_violations"] == []
