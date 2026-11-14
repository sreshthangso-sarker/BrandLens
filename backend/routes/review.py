from fastapi import APIRouter, HTTPException
from database import get_connection
from models import ApproveContentRequest, ReviewRequest

router = APIRouter(tags=["review"])


def get_hydrated_issues(conn, content_id: int):
    rows = conn.execute(
        """
        SELECT
            ar.*,
            ir.id AS review_record_id,
            COALESCE(ir.decision, 'pending') AS decision,
            COALESCE(ir.reviewer_reason, '') AS reviewer_reason,
            COALESCE(ir.correction_decision, 'pending') AS correction_decision,
            COALESCE(ir.final_corrected_text, ar.suggested_correction) AS final_corrected_text,
            ir.reviewed_at AS reviewed_at
        FROM AnalysisResults ar
        LEFT JOIN IssueReviews ir ON ir.issue_id = ar.id
        WHERE ar.content_id = ?
        ORDER BY ar.id ASC
        """,
        (content_id,),
    ).fetchall()
    result = []
    for idx, row in enumerate(rows):
        item = dict(row)
        item["issue_id"] = item.get("issue_id") or f"issue_{idx + 1:03d}"
        item["type"] = item["issue_type"]
        item["suggestion"] = item["suggested_correction"]
        result.append(item)
    return result


@router.post("/api/review/{item_id}")
def save_review(item_id: int, payload: ReviewRequest):
    conn = get_connection()
    try:
        is_issue_review = any(
            v is not None
            for v in (
                payload.decision,
                payload.correction_decision,
                payload.final_corrected_text,
                payload.reviewer_reason,
            )
        )

        if is_issue_review:
            issue = conn.execute(
                "SELECT * FROM AnalysisResults WHERE id = ?", (item_id,)
            ).fetchone()
            if not issue:
                raise HTTPException(status_code=404, detail="Issue record not found.")

            existing_rev = conn.execute(
                "SELECT * FROM IssueReviews WHERE issue_id = ?", (item_id,)
            ).fetchone()

            decision = payload.decision or (existing_rev["decision"] if existing_rev else "pending")
            reviewer_reason = (
                payload.reviewer_reason.strip()
                if payload.reviewer_reason is not None
                else (existing_rev["reviewer_reason"] if existing_rev else "")
            )
            if payload.decision == "rejected" and not reviewer_reason:
                raise HTTPException(
                    status_code=400,
                    detail="A rejection reason is required when rejecting an issue.",
                )

            correction_decision = payload.correction_decision or (
                existing_rev["correction_decision"] if existing_rev else "pending"
            )
            if payload.final_corrected_text is not None:
                final_corrected_text = payload.final_corrected_text.strip()
            elif correction_decision == "accepted":
                final_corrected_text = issue["suggested_correction"]
            elif correction_decision == "rejected":
                final_corrected_text = issue["original_text"]
            elif existing_rev:
                final_corrected_text = existing_rev["final_corrected_text"]
            else:
                final_corrected_text = issue["suggested_correction"]

            conn.execute(
                """
                INSERT INTO IssueReviews (
                    issue_id, content_id, decision, reviewer_reason,
                    correction_decision, final_corrected_text, reviewed_at
                ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(issue_id) DO UPDATE SET
                    decision = excluded.decision,
                    reviewer_reason = excluded.reviewer_reason,
                    correction_decision = excluded.correction_decision,
                    final_corrected_text = excluded.final_corrected_text,
                    reviewed_at = datetime('now')
                """,
                (
                    item_id,
                    issue["content_id"],
                    decision,
                    reviewer_reason,
                    correction_decision,
                    final_corrected_text,
                ),
            )
            conn.commit()
            saved = dict(
                conn.execute("SELECT * FROM IssueReviews WHERE issue_id = ?", (item_id,)).fetchone()
            )
            return {"review": saved, "issues": get_hydrated_issues(conn, issue["content_id"])}

        existing = conn.execute("SELECT * FROM Content WHERE id = ?", (item_id,)).fetchone()
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
            (approval_status, corrected_content, final_content, review_notes, item_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM Content WHERE id = ?", (item_id,)).fetchone()
        return {"content": dict(updated)}
    finally:
        conn.close()


@router.post("/api/approve-content/{content_id}")
def approve_content(content_id: int, payload: ApproveContentRequest):
    conn = get_connection()
    try:
        existing = conn.execute("SELECT * FROM Content WHERE id = ?", (content_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Content record not found.")

        existing_dict = dict(existing)
        corrected_content = (
            payload.corrected_content
            if payload.corrected_content is not None
            else existing_dict["corrected_content"]
        )
        if payload.final_content is not None and payload.final_content.strip():
            final_content = payload.final_content
        elif payload.approval_status == "Approved Original":
            final_content = existing_dict["original_content"]
        else:
            final_content = corrected_content or existing_dict["original_content"]

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
            (payload.approval_status, corrected_content, final_content, review_notes, content_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM Content WHERE id = ?", (content_id,)).fetchone()
        return {"content": dict(updated)}
    finally:
        conn.close()
