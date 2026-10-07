from datetime import date

import pytest

from app.local_suggestions import suggest_from_text


@pytest.mark.parametrize(
    ("text", "role", "axes", "approximate", "certainty"),
    [
        ("现场测量厨房门高度约240cm", "site_measurement", ["height"], True, "explicit"),
        ("设计要求厨房门长度约240cm", "design_requirement", ["length"], True, "explicit"),
        ("门洞约90厘米", "site_measurement", [None], True, "uncertain"),
        ("实测门洞宽90厘米", "site_measurement", ["width"], False, "explicit"),
        ("现场测量插座离地30厘米", "site_measurement", ["离地"], False, "explicit"),
        ("选定60*120cm花砖", "material_spec", [None, None], False, "uncertain"),
        ("现场测量门洞90*210cm", "site_measurement", [None, None], False, "uncertain"),
        ("设计要求门洞90*210cm", "design_requirement", [None, None], False, "uncertain"),
        ("柜体规格60*80*90cm", "material_spec", [None, None, None], False, "uncertain"),
    ],
)
def test_measurement_preserves_meaning(text, role, axes, approximate, certainty):
    result = suggest_from_text("source", text, date(2026, 10, 6))
    measurements = [item for item in result["suggestions"] if item["record_type"] == "measurement"]
    assert len(measurements) == 1
    measurement = measurements[0]
    assert measurement["payload"]["measurement_role"] == role
    assert [value["axis"] for value in measurement["payload"]["values"]] == axes
    assert measurement["payload"]["approximate"] is approximate
    assert measurement["certainty"] == certainty
    if certainty == "uncertain":
        assert measurement["selected_by_default"] is False
        assert measurement["missing_fields"]


def test_three_dimensions_keep_original_values():
    result = suggest_from_text("source", "柜体规格60*80*90cm", date(2026, 10, 6))
    measurement = next(
        item for item in result["suggestions"] if item["record_type"] == "measurement"
    )
    assert [value["value"] for value in measurement["payload"]["values"]] == [60, 80, 90]


def test_multiple_dimensions_never_drop_leading_values():
    result = suggest_from_text("source", "尺寸记录60*80*90*100*120cm", date(2026, 10, 6))
    measurements = [
        item for item in result["suggestions"] if item["record_type"] == "measurement"
    ]
    assert len(measurements) == 1
    assert [value["value"] for value in measurements[0]["payload"]["values"]] == [
        60, 80, 90, 100, 120
    ]
