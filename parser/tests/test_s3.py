from io import BytesIO
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError

from app.s3 import download_pdf


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "test"}}, "operation")


def test_successful_download():
    expected = b"fake pdf content"
    with patch("app.s3._s3") as mock_s3:
        mock_s3.head_object.return_value = {"ContentLength": len(expected)}
        mock_s3.get_object.return_value = {"Body": BytesIO(expected)}
        result = download_pdf("my-bucket", "uploads/user/doc.pdf")
    assert result == expected


def test_file_too_large_raises_before_body_read():
    with patch("app.s3._s3") as mock_s3, patch("app.s3.MAX_FILE_BYTES", 100):
        mock_s3.head_object.return_value = {"ContentLength": 101}
        with pytest.raises(ValueError, match="file_too_large"):
            download_pdf("my-bucket", "uploads/user/doc.pdf")
        mock_s3.get_object.assert_not_called()


def test_key_not_found_raises_key_error():
    with patch("app.s3._s3") as mock_s3:
        mock_s3.head_object.side_effect = _client_error("NoSuchKey")
        with pytest.raises(KeyError):
            download_pdf("my-bucket", "uploads/user/doc.pdf")


def test_other_s3_error_propagates():
    with patch("app.s3._s3") as mock_s3:
        mock_s3.head_object.side_effect = _client_error("AccessDenied")
        with pytest.raises(ClientError):
            download_pdf("my-bucket", "uploads/user/doc.pdf")
