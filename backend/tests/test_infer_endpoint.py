import io

import pytest
from fastapi.testclient import TestClient

from main import MAX_UPLOAD_BYTES, app

client = TestClient(app)

SAMPLE = b"""a,b,c
1,2,red
2,4,red
3,6,blue
4,8,blue
5,10,red
6,12,blue
7,14,red
8,16,blue
9,18,red
10,20,blue
11,22,red
12,24,blue
"""


def _post(content: bytes, name: str = "t.csv"):
    return client.post("/infer", files={"file": (name, io.BytesIO(content), "text/csv")})


def test_health():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_infer_returns_report_shape():
    r = _post(SAMPLE)
    assert r.status_code == 200
    body = r.json()
    for key in ("meta", "profile", "data_quality", "sweep", "findings",
                "needs_review", "imputation_sensitivity", "all_results", "report_markdown"):
        assert key in body
    assert body["meta"]["n_rows"] == 12
    assert body["report_markdown"].startswith("# StatGuard report")


def test_infer_attaches_charts():
    body = _post(SAMPLE).json()
    numeric = [c for c in body["profile"]["columns"] if c["type"] == "numeric"]
    assert numeric and all(c["stats"]["histogram"]["counts"] for c in numeric)

    assert numeric and all(c["stats"]["box"]["median"] is not None for c in numeric)

    corr = [f for f in body["findings"] if f["family"] == "correlation"]
    assert corr, "expected a correlation finding for a perfectly linear column pair"
    chart = corr[0]["charts"][0]
    assert chart["type"] == "scatter"
    assert len(chart["points"]) == chart["n"]
    assert chart["trend"] is not None

    matrix = body["all_results"]["correlation_matrix"]
    assert matrix["columns"] == ["a", "b"]
    ab = next(c for c in matrix["cells"] if (c["i"], c["j"]) == (0, 1))
    assert ab["value"] > 0.99  # a and b are perfectly collinear


def test_markdown_export_includes_chart_sections():
    md = _post(SAMPLE).json()["report_markdown"]
    assert "## Column distributions" in md
    assert "## Correlation matrix" in md
    # the sparkline block and the matrix table are both present
    assert any(ch in md for ch in "▁▂▃▄▅▆▇█")
    assert "| r | a | b |" in md


def test_markdown_export_embeds_contingency_table():
    rows = ["cat,region"]
    for i in range(120):
        cat = "A" if i % 2 else "B"
        region = ("north" if i % 2 else "south") if i % 10 else ("south" if i % 2 else "north")
        rows.append(f"{cat},{region}")
    md = _post("\n".join(rows).encode()).json()["report_markdown"]
    assert "| cat \\ region |" in md


def test_infer_attaches_contingency_chart():
    rows = ["cat,region"]
    for i in range(120):
        cat = "A" if i % 2 else "B"
        region = ("north" if i % 2 else "south") if i % 10 else ("south" if i % 2 else "north")
        rows.append(f"{cat},{region}")
    body = _post("\n".join(rows).encode()).json()
    cont = [f for f in body["findings"] + body["needs_review"] if f["family"] == "contingency"]
    assert cont, "expected a contingency finding for two strongly associated categoricals"
    chart = cont[0]["charts"][0]
    assert chart["type"] == "contingency"
    assert len(chart["counts"]) == len(chart["rows"])
    assert all(len(r) == len(chart["cols"]) for r in chart["counts"])


def test_infer_rejects_garbage():
    r = _post(b"\x00\x01\x02 not a csv at all \xff", "junk.bin")
    assert r.status_code == 400


def test_infer_rejects_empty():
    r = _post(b"   ")
    assert r.status_code == 400


def test_infer_rejects_oversized():
    big = b"a,b\n" + b"1,2\n" * (MAX_UPLOAD_BYTES // 4 + 10)
    r = _post(big)
    assert r.status_code == 400
    assert "too large" in r.json()["detail"].lower()
