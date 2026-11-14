from fastapi import APIRouter, HTTPException
from database import get_connection
from models import BrandPayload

router = APIRouter(prefix="/api/brands", tags=["brands"])


@router.get("")
def list_brands():
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM Brands ORDER BY id ASC").fetchall()
        return {"brands": [dict(row) for row in rows]}
    finally:
        conn.close()


@router.post("", status_code=201)
def create_brand(payload: BrandPayload):
    brand_name = payload.brand_name.strip()
    if not brand_name:
        raise HTTPException(status_code=400, detail="Brand name is required.")

    conn = get_connection()
    try:
        cursor = conn.execute(
            """
            INSERT INTO Brands (
                brand_name, description, tone, preferred_terms,
                prohibited_terms, approved_facts, guidelines
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                brand_name,
                payload.description.strip(),
                payload.tone.strip(),
                payload.preferred_terms.strip(),
                payload.prohibited_terms.strip(),
                payload.approved_facts.strip(),
                payload.guidelines.strip(),
            ),
        )
        conn.commit()
        created = conn.execute(
            "SELECT * FROM Brands WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return {"brand": dict(created)}
    finally:
        conn.close()


@router.get("/{brand_id}")
def get_brand(brand_id: int):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM Brands WHERE id = ?", (brand_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Brand not found.")
        return {"brand": dict(row)}
    finally:
        conn.close()


@router.put("/{brand_id}")
def update_brand(brand_id: int, payload: BrandPayload):
    brand_name = payload.brand_name.strip()
    if not brand_name:
        raise HTTPException(status_code=400, detail="Brand name cannot be empty.")

    conn = get_connection()
    try:
        existing = conn.execute("SELECT * FROM Brands WHERE id = ?", (brand_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Brand not found.")

        conn.execute(
            """
            UPDATE Brands
            SET brand_name = ?, description = ?, tone = ?, preferred_terms = ?,
                prohibited_terms = ?, approved_facts = ?, guidelines = ?
            WHERE id = ?
            """,
            (
                brand_name,
                payload.description.strip(),
                payload.tone.strip(),
                payload.preferred_terms.strip(),
                payload.prohibited_terms.strip(),
                payload.approved_facts.strip(),
                payload.guidelines.strip(),
                brand_id,
            ),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM Brands WHERE id = ?", (brand_id,)).fetchone()
        return {"brand": dict(updated)}
    finally:
        conn.close()
