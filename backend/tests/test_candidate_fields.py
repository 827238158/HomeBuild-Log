from pydantic import BaseModel, TypeAdapter, ValidationError

from app.candidate_fields import candidate_validation_message, normalize_measurement_role
from app.record_schemas import LedgerUpdate, RecordCreate


def test_ledger_currency_aliases_and_foreign_currency_rejection() -> None:
    import pytest

    adapter = TypeAdapter(RecordCreate)
    base = {
        "record_type": "ledger", "status": "paid", "title": "购买把手",
        "source_refs": [{"source_id": "source"}], "ledger_kind": "payment",
        "direction": "expense", "vendor_id": "vendor", "payment_kind": "其他款项",
        "amount_minor": 33826,
    }
    for currency in ["人民币", "RMB", "cny", " CNY "]:
        parsed = adapter.validate_python({**base, "currency": currency})
        assert parsed.currency == "CNY"
        assert parsed.amount_minor == 33826
        updated = LedgerUpdate.model_validate({"record_type": "ledger", "currency": currency})
        assert updated.currency == "CNY"
    assert adapter.validate_python(base).currency == "CNY"
    for currency in ["USD", "美元", "", None]:
        with pytest.raises(ValidationError):
            adapter.validate_python({**base, "currency": currency})


def test_normalize_measurement_role_aliases_and_unknown_value() -> None:
    chinese = {"record_type": "measurement", "measurement_role": "设计要求"}
    unknown = {"record_type": "measurement", "measurement_role": "other"}

    normalize_measurement_role(chinese)
    normalize_measurement_role(unknown)

    assert chinese["measurement_role"] == "design_requirement"
    assert unknown["measurement_role"] == "site_measurement"


def test_candidate_validation_message_hides_pydantic_details() -> None:
    class MeasurementCandidate(BaseModel):
        measurement_role: str

    try:
        MeasurementCandidate.model_validate({})
    except ValidationError as exc:
        message = candidate_validation_message(exc)

    assert message == "尺寸用途不正确，请选择材料规格、现场测量、设计要求或计算结果。"
    assert "Input should be" not in message


def test_candidate_errors_identify_multiple_fields() -> None:
    try:
        TypeAdapter(RecordCreate).validate_python({
            "record_type": "issue", "status": "pending", "title": "",
            "source_refs": [{"source_id": "source"}], "phenomenon": "需处理",
            "severity": "invalid", "occurred_date": "bad-date",
        })
    except ValidationError as exc:
        message = candidate_validation_message(exc)
    assert "标题不能为空" in message
    assert "低、中或高严重程度" in message
    assert "发生日期格式不正确" in message
    assert "invalid" not in message


def test_candidate_preserves_ledger_business_validation() -> None:
    try:
        TypeAdapter(RecordCreate).validate_python({
            "record_type": "ledger", "status": "paid", "title": "付款",
            "source_refs": [{"source_id": "source"}],
        })
    except ValidationError as exc:
        message = candidate_validation_message(exc)
    assert "资金流水必须填写商家、款项性质和金额" in message
