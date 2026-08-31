from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.extractor import extract_pages

FIXTURES = Path(__file__).parent / "fixtures"


def test_normal_pdf_all_pages_have_text():
    pages, _ = extract_pages((FIXTURES / "normal.pdf").read_bytes())
    assert len(pages) == 2
    assert all(p.has_text for p in pages)
    assert all(p.text for p in pages)
    assert all(p.char_count > 0 for p in pages)


def test_multi_page_numbers_are_1_based_and_ordered():
    pages, _ = extract_pages((FIXTURES / "normal.pdf").read_bytes())
    assert [p.page_number for p in pages] == list(range(1, len(pages) + 1))


def test_null_bytes_stripped():
    with patch("pdfplumber.open") as mock_open:
        mock_page = MagicMock()
        mock_page.extract_text.return_value = "Hello\x00World\x00"
        mock_page.images = []
        mock_doc = MagicMock()
        mock_doc.pages = [mock_page]
        mock_doc.metadata = {}
        mock_open.return_value = mock_doc

        pages, _ = extract_pages((FIXTURES / "normal.pdf").read_bytes())

    assert "\x00" not in pages[0].text
    assert "HelloWorld" in pages[0].text


def test_image_only_pdf_raises_no_extractable_text():
    with pytest.raises(ValueError, match="no_extractable_text"):
        extract_pages((FIXTURES / "image_only.pdf").read_bytes())


def test_mixed_pdf_image_pages_have_no_text_text_pages_have_text():
    pages, metadata = extract_pages((FIXTURES / "mixed.pdf").read_bytes())
    text_pages = [p for p in pages if p.has_text]
    image_pages = [p for p in pages if not p.has_text]
    assert len(text_pages) > 0
    assert len(image_pages) > 0
    assert all(p.page_number in metadata.image_only_pages for p in image_pages)


def test_corrupted_bytes_raise_invalid_pdf():
    with pytest.raises(ValueError, match="invalid_pdf"):
        extract_pages((FIXTURES / "corrupted.pdf").read_bytes())


def test_metadata_present():
    _, metadata = extract_pages((FIXTURES / "normal.pdf").read_bytes())
    assert metadata.title == "Test Document"
    assert metadata.author == "Test Author"
    assert metadata.subject == "Test Subject"


def test_metadata_absent_returns_none():
    # mixed.pdf was created without metadata
    _, metadata = extract_pages((FIXTURES / "mixed.pdf").read_bytes())
    assert metadata.title is None
    assert metadata.author is None
    assert metadata.subject is None


def test_pymupdf_fallback_used_when_pdfplumber_returns_empty_for_page_with_images():
    """pdfplumber returns empty text but page has images → pymupdf text is used."""
    pdf_bytes = (FIXTURES / "normal.pdf").read_bytes()

    with patch("pdfplumber.open") as mock_open:
        mock_page = MagicMock()
        mock_page.extract_text.return_value = ""
        mock_page.images = [{"x0": 10}]  # non-empty: page has image content
        mock_doc = MagicMock()
        mock_doc.pages = [mock_page]
        mock_doc.metadata = {}
        mock_open.return_value = mock_doc

        pages, _ = extract_pages(pdf_bytes)

    # fitz opened the real PDF with text; fallback must have provided it
    assert pages[0].has_text is True
    assert pages[0].text
