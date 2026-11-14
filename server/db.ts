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
  original_content: string;
  corrected_content: string;
  final_content: string;
  analysis_status: "Compliant" | "Needs Review" | "Non-Compliant";
  approval_status: "Pending Review" | "Approved Original" | "Approved Corrected" | "Rejected";
  analysis_mode: "gemini" | "demo";
  review_notes: string;
  created_at: string;
}

export interface AnalysisResultRecord {
  id: number;
  content_id: number;
  issue_type: string;
  severity: "High" | "Medium" | "Low";
  original_text: string;
  brand_rule: string;
  explanation: string;
  suggested_correction: string;
  rule_reference: string;
}

const DB_PATH = path.resolve(process.cwd(), "brandlens.db");
export const db = new DatabaseSync(DB_PATH);

/**
 * Initialize SQLite schema and seed the preloaded NovaWear sample brand.
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
  `);

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
