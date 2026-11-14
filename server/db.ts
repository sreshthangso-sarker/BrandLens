import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export interface BrandRecord {
  id: number;
  brand_name: string;
  description: string;
  tone: string;
  preferred_terms: string;
  prohibited_terms: string;
  approved_facts: string;
  guidelines: string;
  created_at: string;
}

export interface ContentRecord {
  id: number;
  brand_id: number;
  title: string;
  content_type: string;
  source_type: string;
  detected_language: string;
  original_content: string;
  corrected_content: string;
  final_content: string;
  analysis_status: "Compliant" | "Needs Review" | "Non-Compliant";
  approval_status: "Pending Review" | "Approved Original" | "Approved Corrected" | "Rejected";
  analysis_mode: "gemini" | "demo";
  review_notes: string;
  created_at: string;
}

export type IssueClassification =
  | "confirmed_violation"
  | "potential_violation"
  | "unverified_claim"
  | "writing_suggestion";

export interface AnalysisResultRecord {
  id: number;
  content_id: number;
  issue_id: string;
  issue_type: string;
  severity: "High" | "Medium" | "Low";
  original_text: string;
  brand_rule: string;
  explanation: string;
  suggested_correction: string;
  rule_reference: string;
  confidence: number;
  classification: IssueClassification;
}

export interface IssueReviewRecord {
  id: number;
  issue_id: number;
  content_id: number;
  decision: "pending" | "accepted" | "rejected";
  reviewer_reason: string;
  correction_decision: "pending" | "accepted" | "rejected" | "edited";
  final_corrected_text: string;
  reviewed_at: string;
}

export interface GuidelineSuggestionRecord {
  id: number;
  brand_id: number;
  target_field: "tone" | "preferred_terms" | "prohibited_terms" | "approved_facts" | "guidelines";
  existing_guideline: string;
  proposed_guideline: string;
  reason: string;
  related_decisions: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  approved_at: string | null;
}

const DB_PATH = path.resolve(process.cwd(), "brandlens.db");
export const db = new DatabaseSync(DB_PATH);

function ensureColumn(tableName: string, columnName: string, columnDefinition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((col) => col.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
  }
}

/**
 * Initialize SQLite schema, migrate Module 2 & Module 3 tables/columns safely, and seed NovaWear.
 */
export function initDatabase(): void {
  db.exec("PRAGMA journal_mode = MEMORY;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
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
  `);

  ensureColumn("Content", "source_type", "TEXT NOT NULL DEFAULT 'text'");
  ensureColumn("Content", "detected_language", "TEXT NOT NULL DEFAULT 'English'");
  ensureColumn("AnalysisResults", "issue_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("AnalysisResults", "confidence", "REAL NOT NULL DEFAULT 0.85");
  ensureColumn("AnalysisResults", "classification", "TEXT NOT NULL DEFAULT 'confirmed_violation'");

  const countRow = db.prepare("SELECT COUNT(*) AS count FROM Brands").get() as { count: number };
  if (countRow.count === 0) {
    db.prepare(`
      INSERT INTO Brands (
        brand_name,
        description,
        tone,
        preferred_terms,
        prohibited_terms,
        approved_facts,
        guidelines
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "NovaWear",
      "A modern sustainable fashion brand.",
      "Friendly, modern and professional",
      "Sustainable fashion",
      "Cheapest, guaranteed, 100% risk-free",
      "Products are made with 70% recycled fabric.",
      "Avoid exaggerated marketing claims."
    );
  }
}
