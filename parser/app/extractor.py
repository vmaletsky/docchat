from io import BytesIO

import fitz
import pdfplumber

from app.models import PageResult, ParseMetadata


def extract_pages(pdf_bytes: bytes) -> tuple[list[PageResult], ParseMetadata]:
    plumber_doc = None
    fitz_doc = None

    try:
        plumber_doc = pdfplumber.open(BytesIO(pdf_bytes))
    except Exception:
        pass

    try:
        fitz_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        pass

    if plumber_doc is None and fitz_doc is None:
        raise ValueError("invalid_pdf")

    try:
        return _extract(plumber_doc, fitz_doc)
    finally:
        if plumber_doc is not None:
            plumber_doc.close()
        if fitz_doc is not None:
            fitz_doc.close()


def _extract(
    plumber_doc, fitz_doc
) -> tuple[list[PageResult], ParseMetadata]:
    page_count = len(plumber_doc.pages) if plumber_doc is not None else fitz_doc.page_count

    meta = (plumber_doc.metadata or {}) if plumber_doc is not None else {}
    title = meta.get("Title") or meta.get("/Title") or None
    author = meta.get("Author") or meta.get("/Author") or None
    subject = meta.get("Subject") or meta.get("/Subject") or None

    pages: list[PageResult] = []
    image_only_page_nums: list[int] = []

    for i in range(page_count):
        page_num = i + 1
        text = ""

        if plumber_doc is not None:
            plumber_page = plumber_doc.pages[i]
            raw = plumber_page.extract_text() or ""
            raw = raw.replace("\x00", "").strip()

            if raw:
                text = raw
            elif plumber_page.images:
                # Image content present but no text layer — try pymupdf
                if fitz_doc is not None:
                    fallback = fitz_doc[i].get_text("text")
                    fallback = fallback.replace("\x00", "").strip()
                    if fallback:
                        text = fallback
        elif fitz_doc is not None:
            raw = fitz_doc[i].get_text("text")
            text = raw.replace("\x00", "").strip()

        has_text = bool(text)
        if not has_text:
            image_only_page_nums.append(page_num)

        pages.append(PageResult(
            page_number=page_num,
            text=text,
            char_count=len(text),
            has_text=has_text,
        ))

    if all(not p.has_text for p in pages):
        raise ValueError("no_extractable_text")

    metadata = ParseMetadata(
        title=title,
        author=author,
        subject=subject,
        total_char_count=sum(p.char_count for p in pages),
        image_only_pages=image_only_page_nums,
    )

    return pages, metadata
