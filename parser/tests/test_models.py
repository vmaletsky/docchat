import pytest
from pydantic import ValidationError

from app.models import (
    ErrorCode,
    ErrorResponse,
    PageResult,
    ParseMetadata,
    ParseRequest,
    ParseResponse,
)


def test_parse_request_rejects_missing_document_id():
    with pytest.raises(ValidationError):
        ParseRequest(s3_key="uploads/u/doc.pdf", bucket="my-bucket")


def test_parse_request_rejects_missing_s3_key():
    with pytest.raises(ValidationError):
        ParseRequest(document_id="doc-1", bucket="my-bucket")


def test_parse_request_rejects_missing_bucket():
    with pytest.raises(ValidationError):
        ParseRequest(document_id="doc-1", s3_key="uploads/u/doc.pdf")


def test_page_result_rejects_page_number_below_1():
    with pytest.raises(ValidationError):
        PageResult(page_number=0, text="hello", char_count=5, has_text=True)


def test_page_result_rejects_negative_page_number():
    with pytest.raises(ValidationError):
        PageResult(page_number=-1, text="hello", char_count=5, has_text=True)


def test_page_result_rejects_negative_char_count():
    with pytest.raises(ValidationError):
        PageResult(page_number=1, text="hello", char_count=-1, has_text=True)


def test_error_response_rejects_unknown_error_code():
    with pytest.raises(ValidationError):
        ErrorResponse(error="unknown_error_code", detail="something went wrong")


def test_parse_request_round_trips_json():
    original = ParseRequest(document_id="doc-1", s3_key="uploads/u/doc.pdf", bucket="my-bucket")
    assert ParseRequest.model_validate_json(original.model_dump_json()) == original


def test_page_result_round_trips_json():
    original = PageResult(page_number=2, text="some text", char_count=9, has_text=True)
    assert PageResult.model_validate_json(original.model_dump_json()) == original


def test_parse_response_round_trips_json():
    metadata = ParseMetadata(
        title="Doc Title",
        author=None,
        subject=None,
        total_char_count=9,
        image_only_pages=[],
    )
    page = PageResult(page_number=1, text="some text", char_count=9, has_text=True)
    original = ParseResponse(document_id="doc-1", page_count=1, pages=[page], metadata=metadata)
    assert ParseResponse.model_validate_json(original.model_dump_json()) == original


def test_error_response_round_trips_json():
    original = ErrorResponse(error=ErrorCode.invalid_pdf, detail="not a PDF")
    assert ErrorResponse.model_validate_json(original.model_dump_json()) == original
