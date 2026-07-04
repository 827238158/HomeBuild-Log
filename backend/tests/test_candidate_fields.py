from pydantic import BaseModel, ValidationError

from app.candidate_fields import candidate_validation_message, normalize_measurement_role


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

