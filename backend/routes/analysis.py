from fastapi import APIRouter, HTTPException
from database import get_connection
from models import AnalyzeRequest
from services.gemini_service import analyze_content_with_ai

router = APIRouter(prefix="/api/analyze", tags=["analysis"])


@router.post("", status_code=201)
def analyze_content(payload: AnalyzeRequest):
    raw_content = payload.content.strip()
    if not raw_content:
        raise HTTPException(status_code=400, detail="Content cannot be empty.")
    if len(raw_content) < 5:
        raise HTTPException(status_code=400, detail="Content must be at least 5 characters.")

    source_type = (payload.source_type or "text").strip() or "text"
    content_type = (
        payload.content_type.strip()
        if payload.content_type and payload.content_type.strip()
        else ("General Text" if source_type == "text" else source_type.upper())
    )
    default_title = (
        f"{source_type.upper()} Check — {raw_content[:42]}{'...' if len(raw_content) > 42 else ''}"
    )
    title = payload.title.strip() if payload.title and payload.title.strip() else default_title

    conn = get_connection()
    try:
        brand_row = conn.execute(
            "SELECT * FROM Brands WHERE id = ?", (payload.brand_id,)
        ).fetchone()
        if not brand_row:
            raise HTTPException(status_code=404, detail="Selected brand not found.")

        brand = dict(brand_row)
        analysis = analyze_content_with_ai(
            brand,
            title,
            content_type,
            raw_content,
            source_type=source_type,
            detected_language_hint=payload.detected_language,
            force_demo=payload.force_demo,
        )

        cursor = conn.execute(
            """
            INSERT INTO Content (
                brand_id, title, content_type, source_type, detected_language,
                original_content, corrected_content, final_content,
                analysis_status, approval_status, analysis_mode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Review', ?)
            """,
            (
                payload.brand_id,
                title,
                content_type,
                source_type,
                analysis["detected_language"],
                raw_content,
                analysis["corrected_content"],
                analysis["corrected_content"],
                analysis["overall_status"],
                analysis["mode"],
            ),
        )
        content_id = cursor.lastrowid

        for issue in analysis["issues"]:
            conn.execute(
                """
                INSERT INTO AnalysisResults (
                    content_id, issue_id, issue_type, severity, original_text, brand_rule,
                    explanation, suggested_correction, rule_reference, confidence, classification
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    content_id,
                    issue["issue_id"],
                    issue["type"],
                    issue["severity"],
                    issue["original_text"],
                    issue["brand_rule"],
                    issue["explanation"],
                    issue["suggestion"],
                    issue["rule_reference"],
                    issue["confidence"],
                    issue["classification"],
                ),
            )

        conn.commit()
        saved_content = dict(
            conn.execute("SELECT * FROM Content WHERE id = ?", (content_id,)).fetchone()
        )
        raw_issues = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM AnalysisResults WHERE content_id = ? ORDER BY id ASC",
                (content_id,),
            ).fetchall()
        ]
        normalized_issues = [
            {
                **row,
                "issue_id": row.get("issue_id") or f"issue_{idx + 1:03d}",
                "type": row["issue_type"],
                "suggestion": row["suggested_correction"],
            }
            for idx, row in enumerate(raw_issues)
        ]

        return {
            "overall_status": saved_content["analysis_status"],
            "detected_language": saved_content["detected_language"],
            "source_type": saved_content["source_type"],
            "corrected_content": saved_content["corrected_content"],
            "content": saved_content,
            "brand": brand,
            "issues": normalized_issues,
            "analysis_mode": analysis["mode"],
            "fallback_reason": analysis.get("fallback_reason"),
        }
    finally:
        conn.close()
