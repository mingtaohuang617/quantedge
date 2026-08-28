from __future__ import annotations

import base64
import hashlib
import hmac
import sys
import time
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import server  # noqa: E402

SECRET = "test-bff-secret-with-at-least-32-characters"


def _signed_headers(method: str, path: str, body: bytes = b"", timestamp: int | None = None):
    request_id = str(uuid.uuid4())
    timestamp = timestamp or int(time.time())
    body_hash = hashlib.sha256(body).hexdigest()
    canonical = f"{timestamp}\n{request_id}\n{method}\n{path}\n{body_hash}"
    signature = base64.urlsafe_b64encode(
        hmac.new(SECRET.encode(), canonical.encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    return {
        "X-QuantEdge-Timestamp": str(timestamp),
        "X-QuantEdge-Request-Id": request_id,
        "X-QuantEdge-Body-SHA256": body_hash,
        "X-QuantEdge-Signature": signature,
    }


def test_health_probe_is_the_only_unsigned_production_route(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("QUANTEDGE_BFF_SECRET", SECRET)
    client = TestClient(server.app)
    assert client.get("/healthz").status_code == 200
    response = client.get("/api/llm/stats")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "bff_signature_invalid"


def test_valid_bff_signature_is_accepted(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("QUANTEDGE_BFF_SECRET", SECRET)
    client = TestClient(server.app)
    path = "/api/mining-alpha/run/status"
    response = client.get(path, headers=_signed_headers("GET", path))
    assert response.status_code == 200


def test_replayed_request_id_is_rejected(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("QUANTEDGE_BFF_SECRET", SECRET)
    client = TestClient(server.app)
    path = "/api/mining-alpha/run/status"
    headers = _signed_headers("GET", path)
    assert client.get(path, headers=headers).status_code == 200
    replay = client.get(path, headers=headers)
    assert replay.status_code == 401
    assert "already been used" in replay.json()["error"]["message"]


def test_expired_and_body_tampered_signatures_are_rejected(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("QUANTEDGE_BFF_SECRET", SECRET)
    client = TestClient(server.app)
    path = "/api/mining-alpha/run/status"
    expired = client.get(path, headers=_signed_headers("GET", path, timestamp=int(time.time()) - 120))
    assert expired.status_code == 401

    body = b'{"run_id":"safe"}'
    headers = _signed_headers("POST", "/api/mining-alpha/run/ic-report", body)
    tampered = client.post("/api/mining-alpha/run/ic-report", headers=headers, content=b'{"run_id":"other"}')
    assert tampered.status_code == 401


def test_request_body_limit_is_enforced_before_signature(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    client = TestClient(server.app)
    response = client.post(
        "/api/mining-alpha/run/backtest",
        headers={"Content-Length": str(server._BFF_MAX_BODY_BYTES + 1)},
        content=b"{}",
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"


def test_run_id_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "_MA_OUTPUT_ROOT", tmp_path)
    for value in ("../outside", "..", "a/b", r"a\b", ".hidden"):
        try:
            server._ma_dir_for(value)
        except server.HTTPException as exc:
            assert exc.status_code == 400
        else:
            raise AssertionError(f"unsafe run_id accepted: {value}")


def test_typed_job_arguments_forbid_unknown_or_cross_step_fields():
    request = server.MiningAlphaRunRequest(run_id="run_20260828", top_n=50, use_tradeable_mask=True)
    assert server._ma_typed_args("backtest", request) == [
        "--run-id", "run_20260828", "--top-n", "50", "--use-tradeable-mask",
    ]
    bad = server.MiningAlphaRunRequest(run_id="safe", n_trials=10)
    try:
        server._ma_typed_args("backtest", bad)
    except server.HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("cross-step parameter was accepted")


def test_duplicate_mining_job_is_rejected(monkeypatch):
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("QUANTEDGE_ENV", raising=False)
    client = TestClient(server.app)
    previous = dict(server._MA_JOB_STATE)
    try:
        server._MA_JOB_STATE["running"] = True
        response = client.post("/api/mining-alpha/run/backtest", json={"run_id": "safe"})
        assert response.status_code == 409
    finally:
        server._MA_JOB_STATE.clear()
        server._MA_JOB_STATE.update(previous)
