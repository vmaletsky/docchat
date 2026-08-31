import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse

from app.auth import verify_token
from app.extractor import extract_pages
from app.models import ErrorCode, ErrorResponse, ParseRequest, ParseResponse
from app.s3 import download_pdf

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    secret = os.environ.get("PARSER_API_SECRET", "")
    if not secret:
        raise RuntimeError("PARSER_API_SECRET is not set or empty")
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/parse")
def parse(request: ParseRequest, _=Depends(verify_token)):
    try:
        pdf_bytes = download_pdf(request.bucket, request.s3_key)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error=ErrorCode.s3_key_not_found,
                detail=f"Key not found: {request.s3_key}",
            ).model_dump(),
        )
    except ValueError as e:
        if str(e) == "file_too_large":
            return JSONResponse(
                status_code=413,
                content=ErrorResponse(
                    error=ErrorCode.file_too_large,
                    detail="File exceeds size limit",
                ).model_dump(),
            )
        raise

    try:
        pages, metadata = extract_pages(pdf_bytes)
    except ValueError as e:
        code = str(e)
        if code == "no_extractable_text":
            return JSONResponse(
                status_code=400,
                content=ErrorResponse(
                    error=ErrorCode.no_extractable_text,
                    detail="PDF contains no extractable text",
                ).model_dump(),
            )
        if code == "invalid_pdf":
            return JSONResponse(
                status_code=400,
                content=ErrorResponse(
                    error=ErrorCode.invalid_pdf,
                    detail="Could not parse PDF",
                ).model_dump(),
            )
        logger.error("Extraction failed for document %s", request.document_id, exc_info=True)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error=ErrorCode.extraction_failed,
                detail="Extraction failed",
            ).model_dump(),
        )
    except Exception:
        logger.error("Extraction failed for document %s", request.document_id, exc_info=True)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error=ErrorCode.extraction_failed,
                detail="Extraction failed",
            ).model_dump(),
        )

    response = ParseResponse(
        document_id=request.document_id,
        page_count=len(pages),
        pages=pages,
        metadata=metadata,
    )
    logger.info("Parsed document %s: %d pages", request.document_id, len(pages))
    return response
