import ipaddress
import os
import re
import socket
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

from bs4 import BeautifulSoup
from services.gemini_service import detect_content_language, is_gemini_configured

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_HTML_BYTES = 3 * 1024 * 1024  # 3 MB
MAX_EXTRACTED_CHARS = 30000

BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata.google.internal",
    "metadata.goog",
    "169.254.169.254",
}


class IngestionError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _is_private_or_reserved_ip(raw_ip: str) -> bool:
    try:
        ip_obj = ipaddress.ip_address(raw_ip.split("%")[0].strip())
    except ValueError:
        return True
    return (
        ip_obj.is_private
        or ip_obj.is_loopback
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
    )


def _assert_public_safe_url(raw_url: str) -> str:
    cleaned = (raw_url or "").strip()
    parsed = urllib.parse.urlparse(cleaned)
    if parsed.scheme not in ("http", "https"):
        raise IngestionError("Only http:// and https:// URLs are supported.", 400)
    if parsed.username or parsed.password:
        raise IngestionError("URLs with embedded credentials are not allowed.", 400)

    hostname = (parsed.hostname or "").lower().rstrip(".")
    if not hostname:
        raise IngestionError("Invalid URL hostname.", 400)

    if (
        hostname in BLOCKED_HOSTNAMES
        or hostname.endswith(".localhost")
        or hostname.endswith(".local")
        or hostname.endswith(".internal")
    ):
        raise IngestionError("Access to localhost and internal network addresses is blocked.", 400)

    try:
        ip_obj = ipaddress.ip_address(hostname)
        if _is_private_or_reserved_ip(str(ip_obj)):
            raise IngestionError("Access to private or internal IP addresses is blocked.", 400)
        return cleaned
    except ValueError:
        pass

    if re.fullmatch(r"\d+", hostname) or re.fullmatch(r"0x[0-9a-f]+", hostname, re.I):
        raise IngestionError("Numeric or obfuscated IP hostnames are not permitted.", 400)

    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise IngestionError(f'Could not resolve domain "{hostname}".', 422) from exc

    for info in infos:
        addr = info[4][0]
        if _is_private_or_reserved_ip(addr):
            raise IngestionError("Access to private or internal network addresses is blocked.", 400)

    return cleaned


def _normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFC", text or "")
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[ \t]+\n", "\n", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
    if len(normalized) > MAX_EXTRACTED_CHARS:
        return normalized[:MAX_EXTRACTED_CHARS].strip()
    return normalized


def ingest_direct_text(raw_text: str, source_name: str = "Direct Text Input") -> Dict[str, Any]:
    cleaned = _normalize_text(raw_text)
    if not cleaned:
        raise IngestionError("Please enter or paste text content before submitting.", 400)
    if len(cleaned) < 5:
        raise IngestionError("Submitted text is too short (minimum 5 characters).", 400)

    return {
        "success": True,
        "source_type": "text",
        "source_name": source_name,
        "detected_language": detect_content_language(cleaned),
        "extracted_text": cleaned,
        "message": "Text content prepared successfully",
    }


def _extract_readable_html(html: str) -> Dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    og_title = soup.find("meta", property="og:title")
    title = ""
    if og_title and og_title.get("content"):
        title = str(og_title.get("content")).strip()
    elif soup.title and soup.title.string:
        title = soup.title.string.strip()
    elif soup.find("h1"):
        title = soup.find("h1").get_text(" ", strip=True)

    for tag in soup(
        [
            "script",
            "style",
            "noscript",
            "iframe",
            "svg",
            "canvas",
            "nav",
            "header",
            "footer",
            "aside",
            "form",
            "button",
            "input",
        ]
    ):
        tag.decompose()

    root = soup.find("article") or soup.find("main") or soup.body or soup
    blocks = []
    seen = set()
    for el in root.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote"]):
        text = re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()
        if len(text) >= 3 and text not in seen:
            seen.add(text)
            blocks.append(text)

    extracted = "\n\n".join(blocks) if blocks else root.get_text("\n", strip=True)
    return {"title": title, "text": _normalize_text(extracted)}


def ingest_website_url(raw_url: str) -> Dict[str, Any]:
    safe_url = _assert_public_safe_url(raw_url)
    req = urllib.request.Request(
        safe_url,
        headers={
            "User-Agent": "BrandLens-ContentChecker/1.0",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            final_url = resp.geturl()
            _assert_public_safe_url(final_url)
            content_type = (resp.headers.get("Content-Type") or "").lower()
            if content_type and not any(
                t in content_type for t in ("text/html", "application/xhtml+xml", "text/plain")
            ):
                raise IngestionError(f"Unsupported URL content type: {content_type}", 400)
            raw_bytes = resp.read(MAX_HTML_BYTES + 1)
            if len(raw_bytes) > MAX_HTML_BYTES:
                raise IngestionError("Webpage HTML exceeds the 3 MB extraction limit.", 400)
    except IngestionError:
        raise
    except urllib.error.HTTPError as exc:
        raise IngestionError(f"Unable to access webpage (HTTP {exc.code}).", 422) from exc
    except Exception as exc:
        raise IngestionError(f"Unable to fetch webpage ({exc}).", 422) from exc

    body_text = raw_bytes.decode("utf-8", errors="replace")
    parsed_url = urllib.parse.urlparse(safe_url)
    page_title = parsed_url.hostname or safe_url

    if "text/plain" in content_type:
        extracted = _normalize_text(body_text)
    else:
        parsed_html = _extract_readable_html(body_text)
        if parsed_html["title"]:
            page_title = parsed_html["title"]
        extracted = parsed_html["text"]

    if not extracted or len(extracted) < 15:
        raise IngestionError(
            "No readable text could be extracted from this webpage.", 422
        )

    return {
        "success": True,
        "source_type": "url",
        "source_name": safe_url,
        "title": page_title,
        "detected_language": detect_content_language(extracted),
        "extracted_text": extracted,
        "message": "Webpage content extracted successfully",
    }


def _extract_with_gemini_multimodal(raw_bytes: bytes, mime_type: str) -> str:
    if not is_gemini_configured():
        return ""
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        prompt = (
            "Extract ALL visible/readable text verbatim in its original language and script "
            "(English, Hindi, Bengali, or mixed). Do NOT translate, summarize, or alter text. "
            "If no readable text exists, return exactly NO_READABLE_TEXT."
        )
        response = client.models.generate_content(
            model="gemini-4-hydrogen",
            contents=[
                types.Part.from_bytes(data=raw_bytes, mime_type=mime_type),
                prompt,
            ],
        )
        text = (response.text or "").strip()
        if not text or text == "NO_READABLE_TEXT":
            return ""
        return _normalize_text(text)
    except Exception:
        return ""


def ingest_uploaded_file(
    file_path: str,
    original_name: str,
    mime_type: str,
    size: int,
    requested_source_type: Optional[str] = None,
) -> Dict[str, Any]:
    if size <= 0:
        raise IngestionError("The uploaded file is empty (0 bytes).", 400)
    if size > MAX_UPLOAD_BYTES:
        raise IngestionError("File size exceeds the 10 MB limit.", 400)

    ext = os.path.splitext(original_name)[1].lower()
    mime_lower = (mime_type or "").lower()
    is_pdf = ext == ".pdf" or mime_lower == "application/pdf"
    is_png = ext == ".png" or mime_lower == "image/png"
    is_jpg = ext in (".jpg", ".jpeg") or mime_lower in ("image/jpeg", "image/jpg")

    if not (is_pdf or is_png or is_jpg):
        raise IngestionError(
            "Unsupported file format. Please upload a PDF, PNG, JPG, or JPEG file.",
            400,
        )

    if requested_source_type == "pdf" and not is_pdf:
        raise IngestionError("Please upload a valid .pdf file.", 400)
    if requested_source_type == "image" and not (is_png or is_jpg):
        raise IngestionError("Please upload a PNG, JPG, or JPEG image file.", 400)

    with open(file_path, "rb") as f:
        raw_bytes = f.read()

    if not raw_bytes:
        raise IngestionError("The uploaded file is empty.", 400)

    stem = os.path.splitext(os.path.basename(original_name))[0].strip() or original_name

    if is_pdf:
        if not raw_bytes.startswith(b"%PDF-"):
            raise IngestionError("The uploaded file is not a valid PDF document.", 400)
        extracted = ""
        try:
            from pypdf import PdfReader
            import io

            reader = PdfReader(io.BytesIO(raw_bytes))
            pages = [(page.extract_text() or "").strip() for page in reader.pages]
            extracted = _normalize_text("\n\n".join(p for p in pages if p))
        except Exception as exc:
            raise IngestionError(f"Failed to parse PDF file: {exc}", 422) from exc

        if len(re.sub(r"\s+", "", extracted)) < 15:
            ocr_text = _extract_with_gemini_multimodal(raw_bytes, "application/pdf")
            if ocr_text:
                extracted = ocr_text

        if not extracted:
            raise IngestionError(
                "No readable embedded text was found in this PDF. Configure GEMINI_API_KEY for scanned PDF OCR.",
                422,
            )

        return {
            "success": True,
            "source_type": "pdf",
            "source_name": original_name,
            "title": stem,
            "detected_language": detect_content_language(extracted),
            "extracted_text": extracted,
            "message": "Content extracted successfully",
        }

    is_valid_png = raw_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    is_valid_jpg = raw_bytes.startswith(b"\xff\xd8\xff")
    if not (is_valid_png or is_valid_jpg):
        raise IngestionError("The uploaded file is not a valid PNG or JPEG image.", 400)

    detected_mime = "image/png" if is_valid_png else "image/jpeg"
    extracted_image_text = _extract_with_gemini_multimodal(raw_bytes, detected_mime)
    if not extracted_image_text:
        raise IngestionError(
            "No readable text was detected in this image. Ensure clear text and configure GEMINI_API_KEY for vision OCR.",
            422,
        )

    return {
        "success": True,
        "source_type": "image",
        "source_name": original_name,
        "title": stem,
        "detected_language": detect_content_language(extracted_image_text),
        "extracted_text": extracted_image_text,
        "message": "Content extracted successfully",
    }
