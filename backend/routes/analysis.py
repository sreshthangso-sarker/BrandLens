from fastapi import APIRouter, HTTPException
from database import get_connection
from models import AnalyzeRequest
from services.gemini_service import analyze_content_with_ai

router = APIRouter(prefix="/api/analyze", tags=["analysis"])


@router.post("", status_code=201)
def analyze_content(payload: AnalyzeRequest):
    title = payload.title.strip()
    content = payload.content.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Please enter a content title.")
    if len(content) < 5:
        raise HTTPException(status_code=400, detail="Content must be at least 5 characters.")

    conn = get_connection()
    try:
        brand_row = conn.execute(
            "SELECT * FROM Brands WHERE id = ?", (payload.brand_id,)
        ).fetchone()
        if not brand_row:
            raise HTTPException(status_code=404, detail="Selected brand not found.")

        brand = dict(brand_row)
        analysis = analyze_content_with_ai(
            brand, title, payload.content_type.strip(), content, payload.force_demo
        )

        cursor = conn.execute(
            """
            INSERT INTO Content (
                brand_id, title, content_type, original_content, corrected_content,
                final_content, analysis_status, approval_status, analysis_mode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Review', ?)
            """,
            (
                payload.brand_id,
                title,
                payload.content_type.strip() or "General Text",
                content,
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
                    content_id, issue_type, severity, original_text, brand_rule,
                    explanation, suggested_correction, rule_reference
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    content_id,
                    issue["type"],
                    issue["severity"],
                    issue["original_text"],
                    issue["brand_rule"],
                    issue["explanation"],
                    issue["suggestion"],
                    issue["rule_reference"],
                ),
            )

        conn.commit()
        saved_content = dict(
            conn.execute("SELECT * FROM Content WHERE id = ?", (content_id,)).fetchone()
        )
        saved_issues = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM AnalysisResults WHERE content_id = ? ORDER BY id ASC",
                (content_id,),
            ).fetchall()
        ]

        return {
            "content": saved_content,
            "brand": brand,
            "issues": saved_issues,
            "analysis_mode": analysis["mode"],
            "fallback_reason": analysis.get("fallback_reason"),
        }
    finally:
        conn.close()
