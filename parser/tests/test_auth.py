import os
from unittest.mock import patch

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth import verify_token
from app.main import app as main_app

_SECRET = os.environ.get("PARSER_API_SECRET", "test-secret-abc123")


@pytest.fixture
def protected_client():
    test_app = FastAPI()

    @test_app.get("/protected")
    def protected(_=Depends(verify_token)):
        return {"ok": True}

    return TestClient(test_app)


def test_correct_token_passes(protected_client):
    resp = protected_client.get(
        "/protected", headers={"Authorization": f"Bearer {_SECRET}"}
    )
    assert resp.status_code == 200


def test_wrong_token_returns_401(protected_client):
    resp = protected_client.get(
        "/protected", headers={"Authorization": "Bearer wrong-token"}
    )
    assert resp.status_code == 401


def test_missing_auth_header_returns_401(protected_client):
    resp = protected_client.get("/protected")
    assert resp.status_code == 401


def test_malformed_header_no_bearer_prefix_returns_401(protected_client):
    resp = protected_client.get(
        "/protected", headers={"Authorization": _SECRET}
    )
    assert resp.status_code == 401


def test_uses_constant_time_comparison(protected_client):
    with patch("app.auth.hmac.compare_digest") as mock_cmp:
        mock_cmp.return_value = True
        protected_client.get(
            "/protected", headers={"Authorization": f"Bearer {_SECRET}"}
        )
    mock_cmp.assert_called_once()


def test_startup_raises_without_secret(monkeypatch):
    monkeypatch.delenv("PARSER_API_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="PARSER_API_SECRET"):
        with TestClient(main_app):
            pass
