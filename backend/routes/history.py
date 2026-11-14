from fastapi import APIRouter, HTTPException
from database import get_connection
from routes.review import get_hydrated_issues

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("")
def list_history():
    conn = get_connection()
    try:
        items = [
            dict(row)
            for row in conn.execute(
                """
                SELECT
                    c.*,
                    b.brand_name,
                    (SELECT COUNT(*) FROM AnalysisResults ar WHERE ar.content_id = c.id) AS issue_count
                FROM Content c
                JOIN Brands b ON b.id = c.brand_id
                ORDER BY c.id DESC
                """
            ).fetchall()
        ]
        stats_row = conn.execute(
            """
            SELECT
                COUNT(*) AS total_analyzed,
                SUM(CASE WHEN analysis_status = 'Compliant' THEN 1 ELSE 0 END) AS compliant_count,
                SUM(CASE WHEN analysis_status = 'Needs Review' THEN 1 ELSE 0 END) AS needs_review_count,
                SUM(CASE WHEN analysis_status = 'Non-Compliant' THEN 1 ELSE 0 END) AS non_compliant_count,
                SUM(CASE WHEN approval_status = 'Pending Review' THEN 1 ELSE 0 END) AS pending_approval_count,
                SUM(CASE WHEN approval_status IN ('Approved Original', 'Approved Corrected') THEN 1 ELSE 0 END) AS approved_count,
                SUM(CASE WHEN approval_status = 'Rejected' THEN 1 ELSE 0 END) AS rejected_count
            FROM Content
            """
        ).fetchone()
        return {"items": items, "stats": dict(stats_row) if stats_row else {}}
    finally:
        conn.close()


@router.get("/{content_id}")
def get_history_detail(content_id: int):
    conn = get_connection()
    try:
        content = conn.execute("SELECT * FROM Content WHERE id = ?", (content_id,)).fetchone()
        if not content:
            raise HTTPException(status_code=404, detail="Analysis record not found.")

        brand = conn.execute(
            "SELECT * FROM Brands WHERE id = ?", (content["brand_id"],)
        ).fetchone()
        issues = get_hydrated_issues(conn, content_id)
        return {
            "content": dict(content),
            "brand": dict(brand) if brand else None,
            "issues": issues,
        }
    finally:
        conn.close()


@router.delete("")
def reset_history():
    conn = get_connection()
    try:
        count_row = conn.execute("SELECT COUNT(*) AS count FROM Content").fetchone()
        deleted_count = int(count_row["count"]) if count_row else 0
        conn.execute("DELETE FROM IssueReviews")
        conn.execute("DELETE FROM AnalysisResults")
        conn.execute("DELETE FROM Content")
        conn.commit()
        return {
            "success": True,
            "deleted_count": deleted_count,
            "stats": {
                "total_analyzed": 0,
                "compliant_count": 0,
                "needs_review_count": 0,
                "non_compliant_count": 0,
                "pending_approval_count": 0,
                "approved_count": 0,
                "rejected_count": 0,
            },
        }
    finally:
        conn.close()
