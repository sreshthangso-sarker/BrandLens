import os
import shutil
import tempfile
import uuid
from fastapi import APIRouter, HTTPException, Request, UploadFile
from services.ingestion_service import (
    MAX_UPLOAD_BYTES,
    IngestionError,
    ingest_direct_text,
    ingest_uploaded_file,
    ingest_website_url,
)

router = APIRouter(prefix="/api/ingest", tags=["ingestion"])


@router.post("")
async def ingest_content(request: Request):
    content_type = (request.headers.get("content-type") or "").lower()
    temp_path = None

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            upload = form.get("file")
            source_type = str(form.get("source_type") or "").strip().lower() or None

            if isinstance(upload, UploadFile) or hasattr(upload, "read"):
                upload_dir = os.path.join(tempfile.gettempdir(), "brandlens-uploads")
                os.makedirs(upload_dir, exist_ok=True)
                ext = os.path.splitext(upload.filename or "")[1][:12]
                temp_path = os.path.join(upload_dir, f"{uuid.uuid4()}{ext}")

                raw_bytes = await upload.read()
                if len(raw_bytes) > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=400, detail="File size exceeds the 10 MB limit.")

                with open(temp_path, "wb") as out:
                    out.write(raw_bytes)

                return ingest_uploaded_file(
                    file_path=temp_path,
                    original_name=upload.filename or "uploaded-file",
                    mime_type=upload.content_type or "",
                    size=len(raw_bytes),
                    requested_source_type=source_type,
                )

            url_val = str(form.get("url") or "").strip()
            text_val = str(form.get("text") or form.get("content") or "")
            if source_type == "url" or url_val:
                return ingest_website_url(url_val)
            return ingest_direct_text(text_val)

        body = await request.json()
        source_type = str(body.get("source_type") or "").strip().lower()
        url_val = str(body.get("url") or "").strip()
        if source_type == "url" or (url_val and not body.get("text") and not body.get("content")):
            return ingest_website_url(url_val)

        raw_text = str(body.get("text") or body.get("content") or "")
        source_name = str(body.get("source_name") or "Direct Text Input").strip() or "Direct Text Input"
        return ingest_direct_text(raw_text, source_name)

    except IngestionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {exc}") from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
