from enum import Enum

from pydantic import BaseModel, Field


class ParseRequest(BaseModel):
    document_id: str
    s3_key: str
    bucket: str


class PageResult(BaseModel):
    page_number: int = Field(ge=1)
    text: str
    char_count: int = Field(ge=0)
    has_text: bool


class ParseMetadata(BaseModel):
    title: str | None
    author: str | None
    subject: str | None
    total_char_count: int
    image_only_pages: list[int]


class ParseResponse(BaseModel):
    document_id: str
    page_count: int
    pages: list[PageResult]
    metadata: ParseMetadata


class ErrorCode(str, Enum):
    no_extractable_text = "no_extractable_text"
    invalid_pdf = "invalid_pdf"
    s3_key_not_found = "s3_key_not_found"
    file_too_large = "file_too_large"
    extraction_failed = "extraction_failed"


class ErrorResponse(BaseModel):
    error: ErrorCode
    detail: str
