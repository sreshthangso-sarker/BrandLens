import json
from fastapi import APIRouter, HTTPException
from database import get_connection
from models import (
    SuggestionApproveRequest,
    SuggestionGenerateRequest,
    SuggestionRejectRequest,
)
from services.learning_service import ALLOWED_FIELDS, generate_guideline_suggestions

router = APIRouter(prefix="/api/guidelines/suggestions", tags=["guideline-learning"])


def _format_suggestion(row) -> dict:
    item = dict(row)
    try:
        item["related_decisions"] = json.loads(item.get("related_decisions") or "[]")
    except Exception:
        item["related_decisions"] = []
    return item


@router.post("", status_code=201)
def create_suggestions(payload: SuggestionGenerateRequest):
    conn = get_connection()
    try:
        brand_row = conn.execute(
            "SELECT * FROM Brands WHERE id = ?", (payload.brand_id,)
        ).fetchone()
        if not brand_row:
            raise HTTPException(status_code=404, detail="Brand not found.")
        brand = dict(brand_row)

        reviews = [
            dict(r)
            for r in conn.execute(
                """
                SELECT
                    ir.id AS review_id,
                    ar.id AS issue_db_id,
                    ar.issue_id AS issue_key,
                    ar.content_id AS content_id,
                    c.content_type AS content_type,
                    ar.issue_type AS issue_type,
                    ar.severity AS severity,
                    ar.original_text AS original_text,
                    ar.brand_rule AS brand_rule,
                    ar.suggested_correction AS suggested_correction,
                    ir.decision AS decision,
                    ir.reviewer_reason AS reviewer_reason,
                    ir.correction_decision AS correction_decision,
                    ir.final_corrected_text AS final_corrected_text,
                    ir.reviewed_at AS reviewed_at
                FROM IssueReviews ir
                JOIN AnalysisResults ar ON ar.id = ir.issue_id
                JOIN Content c ON c.id = ir.content_id
                WHERE c.brand_id = ? AND ir.decision IN ('accepted', 'rejected')
                ORDER BY ir.reviewed_at DESC, ir.id DESC
                """,
                (payload.brand_id,),
            ).fetchall()
        ]

        if not reviews:
            existing = [
                _format_suggestion(r)
                for r in conn.execute(
                    "SELECT * FROM GuidelineSuggestions WHERE brand_id = ? ORDER BY id DESC",
                    (payload.brand_id,),
                ).fetchall()
            ]
            return {
                "suggestions": existing,
                "generated_count": 0,
                "message": "Accept or reject at least one detected issue first.",
            }

        outcome = generate_guideline_suggestions(brand, reviews)
        existing_pending = conn.execute(
            "SELECT existing_guideline, proposed_guideline FROM GuidelineSuggestions WHERE brand_id = ? AND status = 'pending'",
            (payload.brand_id,),
        ).fetchall()

        inserted = 0
        for item in outcome["suggestions"]:
            dup = any(
                p["existing_guideline"].strip() == item["existing_guideline"].strip()
                and p["proposed_guideline"].strip() == item["proposed_guideline"].strip()
                for p in existing_pending
            )
            if dup:
                continue
            conn.execute(
                """
                INSERT INTO GuidelineSuggestions (
                    brand_id, target_field, existing_guideline, proposed_guideline,
                    reason, related_decisions, status
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
                """,
                (
                    payload.brand_id,
                    item["target_field"],
                    item["existing_guideline"],
                    item["proposed_guideline"],
                    item["reason"],
                    json.dumps(item["related_decisions"]),
                ),
            )
            inserted += 1

        conn.commit()
        all_rows = [
            _format_suggestion(r)
            for r in conn.execute(
                "SELECT * FROM GuidelineSuggestions WHERE brand_id = ? ORDER BY id DESC",
                (payload.brand_id,),
            ).fetchall()
        ]
        return {"suggestions": all_rows, "generated_count": inserted, "mode": outcome["mode"]}
    finally:
        conn.close()


@router.get("/{brand_id}")
def list_suggestions(brand_id: int):
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM GuidelineSuggestions WHERE brand_id = ? ORDER BY id DESC",
            (brand_id,),
        ).fetchall()
        return {"suggestions": [_format_suggestion(r) for r in rows]}
    finally:
        conn.close()


@router.post("/{suggestion_id}/approve")
def approve_suggestion(suggestion_id: int, payload: SuggestionApproveRequest):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM GuidelineSuggestions WHERE id = ?", (suggestion_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Guideline suggestion not found.")

        proposed = (
            payload.proposed_guideline.strip()
            if payload.proposed_guideline and payload.proposed_guideline.strip()
            else row["proposed_guideline"]
        )
        target_field = row["target_field"] if row["target_field"] in ALLOWED_FIELDS else "guidelines"

        conn.execute(
            """
            UPDATE GuidelineSuggestions
            SET status = 'approved', proposed_guideline = ?, approved_at = datetime('now')
            WHERE id = ?
            """,
            (proposed, suggestion_id),
        )
        conn.execute(
            f"UPDATE Brands SET {target_field} = ? WHERE id = ?",
            (proposed, row["brand_id"]),
        )
        conn.commit()

        updated_suggestion = _format_suggestion(
            conn.execute(
                "SELECT * FROM GuidelineSuggestions WHERE id = ?", (suggestion_id,)
            ).fetchone()
        )
        updated_brand = dict(
            conn.execute("SELECT * FROM Brands WHERE id = ?", (row["brand_id"],)).fetchone()
        )
        return {"suggestion": updated_suggestion, "brand": updated_brand}
    finally:
        conn.close()


@router.post("/{suggestion_id}/reject")
def reject_suggestion(suggestion_id: int, payload: SuggestionRejectRequest):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM GuidelineSuggestions WHERE id = ?", (suggestion_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Guideline suggestion not found.")

        reason = (
            f"{row['reason']} (Rejected note: {payload.reason.strip()})"
            if payload.reason and payload.reason.strip()
            else row["reason"]
        )
        conn.execute(
            "UPDATE GuidelineSuggestions SET status = 'rejected', reason = ? WHERE id = ?",
            (reason, suggestion_id),
        )
        conn.commit()
        updated = _format_suggestion(
            conn.execute(
                "SELECT * FROM GuidelineSuggestions WHERE id = ?", (suggestion_id,)
            ).fetchone()
        )
        return {"suggestion": updated}
    finally:
        conn.close()
