from fastapi import APIRouter, HTTPException
from database import get_connection
from models import ReviewRequest

router = APIRouter(prefix="/api/review", tags=["review"])


@router.post("/{content_id}")
def save_review(content_id: int, payload: ReviewRequest):
    conn = get_connection()
    try:
        existing = conn.execute("SELECT * FROM Content WHERE id = ?", (content_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Content record not found.")

        existing_dict = dict(existing)
        approval_status = payload.approval_status or existing_dict["approval_status"]
        corrected_content = (
            payload.corrected_content
            if payload.corrected_content is not None
            else existing_dict["corrected_content"]
        )

        if payload.final_content is not None:
            final_content = payload.final_content
        elif approval_status == "Approved Original":
            final_content = existing_dict["original_content"]
        elif approval_status == "Approved Corrected":
            final_content = corrected_content
        else:
            final_content = existing_dict["final_content"]

        review_notes = (
            payload.review_notes.strip()
            if payload.review_notes is not None
            else existing_dict["review_notes"]
        )

        conn.execute(
            """
            UPDATE Content
            SET approval_status = ?, corrected_content = ?, final_content = ?, review_notes = ?
            WHERE id = ?
            """,
            (approval_status, corrected_content, final_content, review_notes, content_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM Content WHERE id = ?", (content_id,)).fetchone()
        return {"content": dict(updated)}
    finally:
        conn.close()
