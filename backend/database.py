import os
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "brandlens.db"
DB_PATH = Path(os.getenv("DATABASE_PATH", str(DEFAULT_DB_PATH)))


def get_connection() -> sqlite3.Connection:
    """Return a SQLite connection with row factory and foreign keys enabled."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = MEMORY;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_database() -> None:
    """Create Brands, Content, and AnalysisResults tables and seed NovaWear."""
    conn = get_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS Brands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                tone TEXT NOT NULL DEFAULT '',
                preferred_terms TEXT NOT NULL DEFAULT '',
                prohibited_terms TEXT NOT NULL DEFAULT '',
                approved_facts TEXT NOT NULL DEFAULT '',
                guidelines TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS Content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content_type TEXT NOT NULL,
                original_content TEXT NOT NULL,
                corrected_content TEXT NOT NULL DEFAULT '',
                final_content TEXT NOT NULL DEFAULT '',
                analysis_status TEXT NOT NULL,
                approval_status TEXT NOT NULL DEFAULT 'Pending Review',
                analysis_mode TEXT NOT NULL DEFAULT 'gemini',
                review_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (brand_id) REFERENCES Brands(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS AnalysisResults (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_id INTEGER NOT NULL,
                issue_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                original_text TEXT NOT NULL,
                brand_rule TEXT NOT NULL,
                explanation TEXT NOT NULL,
                suggested_correction TEXT NOT NULL,
                rule_reference TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (content_id) REFERENCES Content(id) ON DELETE CASCADE
            );
            """
        )

        row = conn.execute("SELECT COUNT(*) AS count FROM Brands").fetchone()
        if row and row["count"] == 0:
            conn.execute(
                """
                INSERT INTO Brands (
                    brand_name, description, tone, preferred_terms,
                    prohibited_terms, approved_facts, guidelines
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "NovaWear",
                    "A modern sustainable fashion brand.",
                    "Friendly, modern and professional",
                    "Sustainable fashion",
                    "Cheapest, guaranteed, 100% risk-free",
                    "Products are made with 70% recycled fabric.",
                    "Avoid exaggerated marketing claims.",
                ),
            )
        conn.commit()
    finally:
        conn.close()
