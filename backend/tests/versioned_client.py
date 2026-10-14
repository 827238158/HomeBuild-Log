from __future__ import annotations

import re
from urllib.parse import urlsplit

from fastapi.testclient import TestClient


class VersionedTestClient(TestClient):
    """既有业务回归使用正常的新客户端协议；并发用例显式传入旧版本。"""

    def request(self, method, url, **kwargs):
        path = urlsplit(str(url)).path
        edit = re.fullmatch(r"/api/v1/(records|research)/([^/]+)", path)
        action = re.fullmatch(r"/api/v1/records/([^/]+)/(archive|restore)", path)
        link = re.fullmatch(r"/api/v1/topics/[^/]+/records/([^/]+)", path)
        record_id = None
        in_body = False
        if method.upper() == "PATCH" and edit:
            record_id, in_body = edit[2], True
        elif method.upper() == "DELETE" and edit and edit[1] == "records":
            record_id = edit[2]
        elif method.upper() == "POST" and action:
            record_id = action[1]
        elif method.upper() in {"PUT", "DELETE"} and link:
            record_id = link[1]
        if record_id:
            values = dict(kwargs.get("json") or {}) if in_body else dict(kwargs.get("params") or {})
            if "expected_version" not in values and "expected_version=" not in str(url):
                response = super().request("GET", f"/api/v1/records/{record_id}")
                values["expected_version"] = (
                    response.json().get("version", 1) if response.status_code == 200 else 1
                )
                kwargs["json" if in_body else "params"] = values
        return super().request(method, url, **kwargs)
