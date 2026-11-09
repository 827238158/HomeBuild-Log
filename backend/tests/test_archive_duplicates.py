from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.domain_models import DEFAULT_PROJECT_ID, Vendor
from tests.test_pitfalls import _client


@pytest.mark.parametrize(
    ("archive_type", "fields", "equivalent_fields"),
    [
        ("vendors", {}, {}),
        ("stages", {}, {}),
        ("materials",
         {"brand": "ＡＢ", "model": "A-12", "color": "蓝", "finish": "哑光"},
         {"brand": "ab", "model": "a-12", "color": "　蓝", "finish": "哑光 "}),
        ("participants", {"contact": "  Ａ@例子.CN  "}, {"contact": "a@例子.cn"}),
        ("spaces", {"kind": "house"}, {"kind": "house"}),
    ],
)
def test_archive_duplicate_returns_existing_option(archive_type, fields, equivalent_fields):
    client = _client()
    url = f"/api/v1/{archive_type}"
    created = client.post(url, json={"name": "  ＡＢ　 装修 ", **fields})
    assert created.status_code == 201, created.text
    assert created.json()["name"] == "  ＡＢ　 装修 "
    duplicate = client.post(url, json={"name": "ab 装修", **equivalent_fields})
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.json()["detail"]["code"] == "archive_duplicate"
    assert duplicate.json()["detail"]["matches"] == [created.json()]
    assert client.post(url, json={"name": "　 ", **fields}).status_code == 422


@pytest.mark.parametrize(
    ("archive_type", "first_fields", "second_fields"),
    [
        ("materials", {"model": "AB-11"}, {"model": "AB-12"}),
        ("participants", {"contact": "111"}, {"contact": "222"}),
        ("spaces", {"kind": "room"}, {"kind": "room"}),
    ],
)
def test_same_name_with_different_identity_and_edit_collision(archive_type, first_fields, second_fields):
    client = _client()
    url = f"/api/v1/{archive_type}"
    if archive_type == "spaces":
        parents = [client.post(url, json={"name": name, "kind": "house"}).json()["id"]
                   for name in ("东区", "西区")]
        first_fields = {**first_fields, "parent_id": parents[0]}
        second_fields = {**second_fields, "parent_id": parents[1]}
    first = client.post(url, json={"name": "同名", **first_fields})
    second = client.post(url, json={"name": "同名", **second_fields})
    assert first.status_code == second.status_code == 201
    edit = client.patch(f"{url}/{second.json()['id']}", json=first_fields)
    assert edit.status_code == 409
    assert edit.json()["detail"]["matches"] == [first.json()]


def test_legacy_duplicates_are_flagged_and_can_still_update_notes():
    client = _client()
    url = "/api/v1/vendors"
    created = client.post(url, json={"name": "a 商家"}).json()
    with Session(client.app.state.engine) as db:
        old = Vendor(project_id=DEFAULT_PROJECT_ID, name="Ａ　商家")
        db.add(old)
        db.commit()
        old_id = old.id

    assert {row["id"] for row in client.get(url).json() if row.get("duplicate")} == {
        created["id"], old_id,
    }
    updated = client.patch(f"{url}/{old_id}", json={"notes": "补充备注"})
    assert updated.status_code == 200
    assert updated.json()["notes"] == "补充备注"
    assert len(client.post(url, json={"name": "A 商家"}).json()["detail"]["matches"]) == 2


def test_concurrent_archive_creates_only_one_row():
    client = _client()
    url = "/api/v1/vendors"
    start = Barrier(2)

    def create(name):
        start.wait(timeout=5)
        return client.post(url, json={"name": name})

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(create, ("Ａ", "a")))
    assert sorted(response.status_code for response in results) == [201, 409]
    created = next(response.json() for response in results if response.status_code == 201)
    duplicate = next(response.json() for response in results if response.status_code == 409)
    assert duplicate["detail"]["matches"] == [created]
    assert client.get(url).json() == [created]
