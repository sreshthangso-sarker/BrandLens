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


def _ensure_column(conn: sqlite3.Connection, table_name: str, column_name: str, column_def: str) -> None:
    cols = [row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]
    if column_name not in cols:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_def};")


def init_database() -> None:
    """Create Brands, Content, and AnalysisResults tables, migrate Module 2 columns, and seed NovaWear."""
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
                source_type TEXT NOT NULL DEFAULT 'text',
                detected_language TEXT NOT NULL DEFAULT 'English',
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
                issue_id TEXT NOT NULL DEFAULT '',
                issue_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                original_text TEXT NOT NULL,
                brand_rule TEXT NOT NULL,
                explanation TEXT NOT NULL,
                suggested_correction TEXT NOT NULL,
                rule_reference TEXT NOT NULL DEFAULT '',
                confidence REAL NOT NULL DEFAULT 0.85,
                classification TEXT NOT NULL DEFAULT 'confirmed_violation',
                FOREIGN KEY (content_id) REFERENCES Content(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS IssueReviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                issue_id INTEGER NOT NULL UNIQUE,
                content_id INTEGER NOT NULL,
                decision TEXT NOT NULL DEFAULT 'pending',
                reviewer_reason TEXT NOT NULL DEFAULT '',
                correction_decision TEXT NOT NULL DEFAULT 'pending',
                final_corrected_text TEXT NOT NULL DEFAULT '',
                reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (issue_id) REFERENCES AnalysisResults(id) ON DELETE CASCADE,
                FOREIGN KEY (content_id) REFERENCES Content(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS GuidelineSuggestions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER NOT NULL,
                target_field TEXT NOT NULL DEFAULT 'guidelines',
                existing_guideline TEXT NOT NULL DEFAULT '',
                proposed_guideline TEXT NOT NULL,
                reason TEXT NOT NULL,
                related_decisions TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                approved_at TEXT,
                FOREIGN KEY (brand_id) REFERENCES Brands(id) ON DELETE CASCADE
            );
            """
        )

        _ensure_column(conn, "Content", "source_type", "TEXT NOT NULL DEFAULT 'text'")
        _ensure_column(conn, "Content", "detected_language", "TEXT NOT NULL DEFAULT 'English'")
        _ensure_column(conn, "AnalysisResults", "issue_id", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "AnalysisResults", "confidence", "REAL NOT NULL DEFAULT 0.85")
        _ensure_column(conn, "AnalysisResults", "classification", "TEXT NOT NULL DEFAULT 'confirmed_violation'")

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
