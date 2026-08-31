# Parser Service — Backlog

Items are ordered by dependency. Each item is self-contained and shippable independently once its prerequisites are done.

---

## P0 — Foundation

### PARSE-1: Project scaffold
Set up the `/parser` directory structure, `requirements.txt`, `Dockerfile`, and `.env.example`.
- Create `app/__init__.py`, `app/main.py` (bare FastAPI app with lifespan), `app/models.py`
- Add `GET /health` endpoint (no auth, returns `{"status": "ok"}`)
- Add `requirements.txt` with pinned versions
- Add `Dockerfile` (python:3.12-slim, installs deps, runs uvicorn)
- Add `parser/.env.example` with all required env vars
- Add `pytest`, `httpx`, `pytest-asyncio` to `requirements.txt` (test deps)

**Tests** (`tests/test_health.py`):
- `GET /health` returns `200` and `{"status": "ok"}`
- `GET /health` returns 200 with no `Authorization` header (auth must not be applied here)

**Done when**: `docker build` succeeds, `GET /health` returns 200, and pytest passes.

---

### PARSE-2: Pydantic models
Define all request/response/error models in `app/models.py`.
- `ParseRequest`: `document_id` (str), `s3_key` (str), `bucket` (str)
- `PageResult`: `page_number` (int ≥ 1), `text` (str), `char_count` (int ≥ 0), `has_text` (bool)
- `ParseMetadata`: `title` (str | None), `author` (str | None), `subject` (str | None), `total_char_count` (int), `image_only_pages` (list[int])
- `ParseResponse`: `document_id` (str), `page_count` (int), `pages` (list[PageResult]), `metadata` (ParseMetadata)
- `ErrorResponse`: `error` (enum: `no_extractable_text`, `invalid_pdf`, `s3_key_not_found`, `file_too_large`, `extraction_failed`), `detail` (str)

**Tests** (`tests/test_models.py`):
- `ParseRequest` rejects missing fields
- `PageResult` rejects `page_number < 1` and `char_count < 0`
- `ErrorResponse` rejects unknown `error` enum values
- Valid inputs round-trip through JSON serialization unchanged

**Done when**: All model tests pass; `from app.models import *` imports cleanly.

---

### PARSE-3: Service-to-service auth
Implement shared-secret Bearer token authentication as a FastAPI dependency.
- Read `PARSER_API_SECRET` from env at startup; raise `RuntimeError` if missing or empty
- `verify_token` dependency: extract `Authorization: Bearer <token>`, validate with `hmac.compare_digest`
- Return `401` with `ErrorResponse(error="extraction_failed", detail="Unauthorized")` on missing or wrong token
- `/health` must NOT use this dependency

**Tests** (`tests/test_auth.py`):
- Request with correct token passes (returns non-401)
- Request with wrong token returns `401`
- Request with missing `Authorization` header returns `401`
- Request with malformed header (`Bearer` prefix absent) returns `401`
- Validation uses constant-time comparison (assert `hmac.compare_digest` is called, not `==`)

**Done when**: All auth tests pass; `verify_token` is importable as a FastAPI `Depends`.

---

## P1 — Core Parser

### PARSE-4: PDF text extraction
Implement `app/extractor.py` with pdfplumber primary + pymupdf fallback.
- `extract_pages(pdf_bytes: bytes) -> tuple[list[PageResult], ParseMetadata]`
- For each page: try pdfplumber `page.extract_text()`; if empty and page has content, retry with pymupdf `page.get_text("text")`
- Strip null bytes (`\x00`) from all text
- Strip leading/trailing whitespace per page
- Mark `has_text=False` for image-only pages; include their `page_number` in `metadata.image_only_pages`
- Extract PDF metadata (`/Title`, `/Author`, `/Subject`) via pdfplumber; return `None` for absent keys
- Raise `ValueError("no_extractable_text")` if **all** pages have `has_text=False`
- Raise `ValueError("invalid_pdf")` if the file cannot be opened by either library

**Tests** (`tests/test_extractor.py`):
- Normal PDF: returns correct page count; text is non-empty; `has_text=True` on all pages
- Multi-page PDF: page numbers are 1-based and in order
- PDF with null bytes in text: output contains no `\x00` characters
- Image-only PDF: raises `ValueError("no_extractable_text")`
- Mixed PDF (some image pages): those pages have `has_text=False`; others have text; no exception raised
- Corrupted bytes: raises `ValueError("invalid_pdf")`
- Metadata extraction: title/author populated when present; `None` when absent
- pymupdf fallback: mock pdfplumber to return empty string for a page; assert pymupdf result is used instead

Add fixture PDFs to `tests/fixtures/`: `normal.pdf`, `image_only.pdf`, `mixed.pdf`, `corrupted.pdf`.

**Done when**: All extraction tests pass including fallback path.

---

### PARSE-5: S3 download helper
Implement `app/s3.py` for downloading PDFs from S3.
- `download_pdf(bucket: str, key: str) -> bytes`
- Head-check `ContentLength` before downloading body; raise `ValueError("file_too_large")` if `> MAX_FILE_BYTES`
- Raise `KeyError` on `NoSuchKey` (boto3 `ClientError` with code `NoSuchKey`)
- Boto3 client constructed once at module load from env vars
- `MAX_FILE_BYTES` read from env, default `20971520` (20 MB)

**Tests** (`tests/test_s3.py`):
- Successful download: mock `s3.get_object` to return bytes; assert returned bytes match
- File too large: mock `ContentLength` above limit; assert `ValueError("file_too_large")` raised before body is read
- Key not found: mock `ClientError` with `NoSuchKey`; assert `KeyError` raised
- Other S3 error (e.g. access denied): propagates as-is (not swallowed)

All S3 tests use `unittest.mock.patch`; no real AWS calls.

**Done when**: All S3 unit tests pass; no real AWS credentials required to run them.

---

### PARSE-6: `POST /parse` endpoint
Wire S3 download + extractor + auth into the main parse endpoint.
- Apply `verify_token` dependency
- Call `download_pdf()` → map `KeyError` → 404, `ValueError("file_too_large")` → 413
- Call `extract_pages()` → map `ValueError("no_extractable_text")` → 400, `ValueError("invalid_pdf")` → 400, unexpected exception → 500
- Return `ParseResponse` on success
- Log `document_id` and `page_count` at INFO on success; log full traceback at ERROR on 500

**Tests** (`tests/test_parse_endpoint.py`):
- Valid request with mocked S3 + extractor: returns `200` with correct `ParseResponse` shape
- Auth failure: returns `401` before S3 or extractor is called
- S3 key not found: returns `404` with `error: "s3_key_not_found"`
- File too large: returns `413` with `error: "file_too_large"`
- All-image PDF: returns `400` with `error: "no_extractable_text"`
- Invalid PDF bytes: returns `400` with `error: "invalid_pdf"`
- Unexpected extractor exception: returns `500` with `error: "extraction_failed"`
- Response body matches `ParseResponse` Pydantic schema (validate with `ParseResponse.model_validate`)

All tests use `TestClient` (httpx); S3 and extractor are mocked.

**Done when**: All endpoint tests pass; Python service is feature-complete.

---

## P2 — Node.js Integration

### PARSE-7: S3 helpers in Node.js
Create `src/lib/storage.ts` with upload and delete functions.
- `uploadToS3(buffer: Buffer, key: string): Promise<void>` — uses AWS SDK v3 `PutObjectCommand`
- `deleteFromS3(key: string): Promise<void>` — uses `DeleteObjectCommand`
- Key format: `uploads/{userId}/{documentId}.pdf`
- S3 client configured from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`
- Add `@aws-sdk/client-s3` to `package.json`

**Tests** (`src/lib/storage.test.ts`):
- `uploadToS3` calls `PutObjectCommand` with correct `Bucket`, `Key`, `Body`, and `ContentType: "application/pdf"` — mock the S3 client
- `deleteFromS3` calls `DeleteObjectCommand` with correct `Bucket` and `Key`
- `uploadToS3` propagates S3 client errors (does not swallow them)
- `deleteFromS3` propagates S3 client errors

**Done when**: TypeScript compiles clean; all storage unit tests pass with mocked S3 client.

---

### PARSE-8: Parser HTTP client in Node.js
Create `src/lib/parser.ts` with a typed client for the parser service.
- `callParser(documentId: string, s3Key: string): Promise<ParseResponse>`
- POST to `${PARSER_URL}/parse` with `Authorization: Bearer ${PARSER_API_SECRET}`
- 60-second timeout (covers large PDFs)
- On non-2xx: throw `ParserError` containing `error` enum value and `detail` from response body
- Define `ParseResponse` and `ParserError` TypeScript types matching the Python Pydantic models

**Tests** (`src/lib/parser.test.ts`):
- Successful response: returns typed `ParseResponse` with correct shape
- Non-2xx response: throws `ParserError` with `error` and `detail` from response body
- Network error / timeout: propagates as thrown error (not silently ignored)
- Request includes `Authorization: Bearer <secret>` header
- Request body contains `document_id`, `s3_key`, and `bucket`

Mock `fetch` (or use `jest.spyOn`) — no real HTTP calls.

**Done when**: TypeScript compiles clean; all parser client tests pass.

---

### PARSE-9: Update `runIngest` to use parser + S3
Modify `src/lib/ingest.ts` to replace the local `extractPages()` call with the new pipeline.
- Change signature: `runIngest(documentId: string, s3Key: string): Promise<void>`
- Call `callParser(documentId, s3Key)`, map `ParseResponse.pages` → `{ pageNumber: number; text: string }[]`
- After successful ingest: call `deleteFromS3(s3Key)` wrapped in try/catch (log error, do not fail ingest)
- On `ParserError`: existing `status="error"` handler catches it; store `error.detail` as `errorMessage`
- Remove `extractPages()` function and `pdf-parse` import

**Tests** (`src/lib/ingest.test.ts`):
- Update existing tests: replace `extractPages` mock with `callParser` mock
- Successful parse + ingest: `status="ready"`, correct `chunkCount` and `charCount` persisted
- `callParser` throws `ParserError`: `status="error"`, `errorMessage` set to `error.detail`
- `deleteFromS3` throws after successful ingest: ingest is still marked `status="ready"` (delete error is non-fatal)
- `deleteFromS3` is called with the same `s3Key` passed to `runIngest`

**Done when**: TypeScript compiles clean; all updated ingest tests pass.

---

### PARSE-10: Update upload route to upload PDF to S3
Modify `src/app/api/upload/route.ts` to upload the buffer to S3 before kicking off ingest.
- After `createDocumentRecord()`, derive `s3Key = uploads/${userId}/${documentId}.pdf`
- Call `await uploadToS3(buffer, s3Key)`
- On `uploadToS3` failure: set document `status="error"` and return `500` (do not leave record stuck in `"processing"`)
- Pass `s3Key` (not `buffer`) to `waitUntil(runIngest(documentId, s3Key))`

**Tests** (`src/app/api/upload/route.test.ts`):
- Successful upload: `uploadToS3` called with correct key and buffer; response contains `documentId` and `status: "processing"`
- `uploadToS3` throws: response is `500`; document `status` updated to `"error"` in DB
- Deduplicated upload: `uploadToS3` is NOT called (buffer is already stored from first upload)
- `runIngest` is called via `waitUntil` with the derived `s3Key`, not the raw buffer

**Done when**: TypeScript compiles clean; all upload route tests pass.

---

### PARSE-11: Add new env vars to Node.js
Update `.env.example` and validate presence at startup.
- Add to `.env.example`: `PARSER_URL`, `PARSER_API_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`
- Add startup validation in `src/lib/storage.ts` and `src/lib/parser.ts`: throw on missing required env vars (same pattern as existing DB_URL guard)

**Tests**:
- `storage.ts`: throws on missing `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, or `S3_BUCKET`
- `parser.ts`: throws on missing `PARSER_URL` or `PARSER_API_SECRET`

**Done when**: `.env.example` updated; startup validation tests pass.

---

## P3 — Hardening

### PARSE-12: Remove `pdf-parse` dependency
Once PARSE-9 ships and is verified in production, remove `pdf-parse` from `package.json`.
- `npm uninstall pdf-parse` + remove `@types/pdf-parse` if present
- Delete `extractPages()` and any remaining references
- Verify TypeScript compiles clean and no test imports `pdf-parse`

**Tests**: existing test suite still passes with no changes needed (confirming no hidden dependency remains).

**Done when**: `pdf-parse` does not appear in `package.json`, imports, or test files.

---

### PARSE-13: S3 object lifecycle policy
Configure an S3 bucket lifecycle rule to auto-delete objects under `uploads/` after 1 day as a safety net for crashed ingests.
- Apply via AWS console or IaC (not a code change)
- No unit tests (infrastructure config, not application logic)

**Done when**: Lifecycle rule is visible in S3 bucket configuration.

---

### PARSE-14: Parser service error surfaced in UI
Ensure the UI shows a meaningful message when parsing fails.
- Verify `DocumentsTree` reads and displays `errorMessage` for `status="error"` documents
- If not shown: update `DocumentsTree` to render an error state (e.g. red icon + tooltip with message)

**Tests** (`src/components/DocumentsTree.test.tsx`):
- Document with `status="error"` and `errorMessage` renders an error indicator
- Document with `status="error"` and `errorMessage=null` renders a generic error indicator (no crash)
- Document with `status="ready"` renders normally (regression check)
- Document with `status="processing"` renders a loading indicator (regression check)

**Done when**: Uploading an image-only PDF shows an error state in the UI, not a spinner; all component tests pass.

---

## Dependency Graph

```
PARSE-1 (scaffold)
  └── PARSE-2 (models)
        ├── PARSE-3 (auth)
        └── PARSE-4 (extractor)
              └── PARSE-5 (S3 download)
                    └── PARSE-6 (endpoint)  ← Python service complete
                          │
                          ▼
                    PARSE-7 (Node S3 helpers)
                    PARSE-8 (Node parser client)
                          └── PARSE-9 (update runIngest)
                                └── PARSE-10 (update upload route)
                                      └── PARSE-11 (env vars)
                                            │
                                            ▼
                                    PARSE-12 (remove pdf-parse)
                                    PARSE-13 (S3 lifecycle)
                                    PARSE-14 (UI error state)
```
