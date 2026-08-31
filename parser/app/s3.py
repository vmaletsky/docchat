import os

import boto3
from botocore.exceptions import ClientError

MAX_FILE_BYTES = int(os.environ.get("MAX_FILE_BYTES", 20_971_520))

_s3 = boto3.client("s3")


def download_pdf(bucket: str, key: str) -> bytes:
    try:
        head = _s3.head_object(Bucket=bucket, Key=key)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("NoSuchKey", "404"):
            raise KeyError(key) from e
        raise

    if head.get("ContentLength", 0) > MAX_FILE_BYTES:
        raise ValueError("file_too_large")

    try:
        response = _s3.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("NoSuchKey", "404"):
            raise KeyError(key) from e
        raise
