import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import PageResult, ParseMetadata, ParseResponse

_SECRET = os.environ.get("PARSER_API_SECRET", "test-secret-abc123")
_AUTH = {"Authorization": f"Bearer {_SECRET}"}
_BODY = {"document_id": "doc-1", "s3_key": "uploads/user/doc.pdf", "bucket": "my-bucket"}

_PAGES = [PageResult(page_number=1, text="Hello world", char_count=11, has_text=True)]
_META = ParseMetadata(title=None, author=None, subject=None, total_char_count=11, image_only_pages=[])


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def test_valid_request_returns_200_with_parse_response(client):
    with patch("app.main.download_pdf", return_value=b"pdf") as mock_dl, \
         patch("app.main.extract_pages", return_value=(_PAGES, _META)):
        resp = client.post("/parse", json=_BODY, headers=_AUTH)
    assert resp.status_code == 200
    parsed = ParseResponse.model_validate(resp.json())
    assert parsed.document_id == "doc-1"
    assert parsed.page_count == 1
    mock_dl.assert_called_once_with("my-bucket", "uploads/user/doc.pdf")


def test_auth_failure_returns_401_without_calling_s3_or_extractor(client):
    with patch("app.main.download_pdf") as mock_dl, \
         patch("app.main.extract_pages") as mock_ext:
        resp = client.post("/parse", json=_BODY, headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401
    mock_dl.assert_not_called()
    mock_ext.assert_not_called()


def test_s3_key_not_found_returns_404(client):
    with patch("app.main.download_pdf", side_effect=KeyError("uploads/user/doc.pdf")):
        resp = client.post("/parse", json=_BODY, headers=_AUTH)
    assert resp.status_code == 404
    assert resp.json()["error"] == "s3_key_not_found"


def test_file_too_large_returns_413(client):
    with patch("app.main.download_pdf", side_effect=ValueError("file_too_large")):
        resp = client.post("/parse", json=_BODY, headers=_AUTH)
    assert resp.status_code == 413
    assert resp.json()["error"] == "file_too_large"


def test_all_image_pdf_returns_400_no_extractable_text(client):
    with patch("app.main.download_pdf", return_value=b"pdf"), \
         patch("app.main.extract_pages", side_effect=ValueError("no_extractable_text")):
        resp = client.post("/parse", json=_BODY, headers=_AUTH)
    assert resp.status_code == 400
    assert resp.json()["error"] == "no_extractable_text"


def test_invalid_pdf_returns_400(client):
    with patch("app.main.download_pdf", return_value=b"bad"), \
         patch("app.main.extract_pages", side_effect=ValueError("invalid_pdf")):
        resp = client.post("/parse", json=_BODY, headers=_AUTH)
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_pdf"


def test_unexpected_extractor_exception_returns_500(client):
    with patch("app.main.download_pdf", return_value=b"pdf"), \
         patch("app.main.extract_pages", side_effect=RuntimeError("boom")):
        resp = client.post("/parse", json=_BODY, headers=_AUTH)
    assert resp.status_code == 500
    assert resp.json()["error"] == "extraction_failed"


def test_response_validates_against_parse_response_schema(client):
    with patch("app.main.download_pdf", return_value=b"pdf"), \
         patch("app.main.extract_pages", return_value=(_PAGES, _META)):
        resp = client.post("/parse", json=_BODY, headers=_AUTH)
    ParseResponse.model_validate(resp.json())
