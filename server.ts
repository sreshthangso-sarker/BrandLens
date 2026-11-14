import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { db, initDatabase } from "./server/db.ts";
import type { BrandRecord, ContentRecord, AnalysisResultRecord } from "./server/db.ts";
import { analyzeContentWithAI, isGeminiConfigured } from "./server/analyzer.ts";
import {
  IngestionError,
  MAX_UPLOAD_BYTES,
  ingestDirectText,
  ingestUploadedFile,
  ingestWebsiteUrl,
} from "./server/ingestion.ts";
import { generateGuidelineSuggestions } from "./server/learning.ts";
import type { JoinedReviewDecision } from "./server/learning.ts";
import type { IssueReviewRecord, GuidelineSuggestionRecord } from "./server/db.ts";

initDatabase();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));

const TEMP_UPLOAD_DIR = path.join(os.tmpdir(), "brandlens-uploads");
fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true, mode: 0o700 });

const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true, mode: 0o700 });
      cb(null, TEMP_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const safeExt = path.extname(file.originalname || "").replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12);
      cb(null, `${crypto.randomUUID()}${safeExt}`);
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
});

function parseId(param: string | string[] | undefined): number | null {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw) return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

// 1. Health check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    database: "connected",
    ai_mode: isGeminiConfigured() ? "gemini" : "demo",
    model: "gemini-4-hydrogen",
  });
});

// 2. Retrieve all brands
app.get("/api/brands", (_req: Request, res: Response) => {
  try {
    const brands = db.prepare("SELECT * FROM Brands ORDER BY id ASC").all() as unknown as BrandRecord[];
    res.json({ brands });
  } catch (err) {
    console.error("GET /api/brands error:", err);
    res.status(500).json({ error: "Failed to retrieve brands." });
  }
});

// 3. Create a brand
app.post("/api/brands", (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const brand_name = typeof body.brand_name === "string" ? body.brand_name.trim() : "";
    if (!brand_name) {
      res.status(400).json({ error: "Brand name is required." });
      return;
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const tone = typeof body.tone === "string" ? body.tone.trim() : "";
    const preferred_terms = typeof body.preferred_terms === "string" ? body.preferred_terms.trim() : "";
    const prohibited_terms = typeof body.prohibited_terms === "string" ? body.prohibited_terms.trim() : "";
    const approved_facts = typeof body.approved_facts === "string" ? body.approved_facts.trim() : "";
    const guidelines = typeof body.guidelines === "string" ? body.guidelines.trim() : "";

    const result = db
      .prepare(`
        INSERT INTO Brands (brand_name, description, tone, preferred_terms, prohibited_terms, approved_facts, guidelines)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(brand_name, description, tone, preferred_terms, prohibited_terms, approved_facts, guidelines);

    const created = db
      .prepare("SELECT * FROM Brands WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as unknown as BrandRecord;

    res.status(201).json({ brand: created });
  } catch (err) {
    console.error("POST /api/brands error:", err);
    res.status(500).json({ error: "Failed to create brand." });
  }
});

// 4. Retrieve single brand guidelines
app.get("/api/brands/:id", (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid brand ID." });
    return;
  }
  const brand = db.prepare("SELECT * FROM Brands WHERE id = ?").get(id) as unknown as BrandRecord | undefined;
  if (!brand) {
    res.status(404).json({ error: "Brand not found." });
    return;
  }
  res.json({ brand });
});

// 5. Update brand guidelines
app.put("/api/brands/:id", (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid brand ID." });
    return;
  }

  const existing = db.prepare("SELECT * FROM Brands WHERE id = ?").get(id) as unknown as BrandRecord | undefined;
  if (!existing) {
    res.status(404).json({ error: "Brand not found." });
    return;
  }

  const body = req.body ?? {};
  const brand_name = typeof body.brand_name === "string" ? body.brand_name.trim() : existing.brand_name;
  if (!brand_name) {
    res.status(400).json({ error: "Brand name cannot be empty." });
    return;
  }

  const description = typeof body.description === "string" ? body.description.trim() : existing.description;
  const tone = typeof body.tone === "string" ? body.tone.trim() : existing.tone;
  const preferred_terms = typeof body.preferred_terms === "string" ? body.preferred_terms.trim() : existing.preferred_terms;
  const prohibited_terms = typeof body.prohibited_terms === "string" ? body.prohibited_terms.trim() : existing.prohibited_terms;
  const approved_facts = typeof body.approved_facts === "string" ? body.approved_facts.trim() : existing.approved_facts;
  const guidelines = typeof body.guidelines === "string" ? body.guidelines.trim() : existing.guidelines;

  db.prepare(`
    UPDATE Brands
    SET brand_name = ?, description = ?, tone = ?, preferred_terms = ?, prohibited_terms = ?, approved_facts = ?, guidelines = ?
    WHERE id = ?
  `).run(brand_name, description, tone, preferred_terms, prohibited_terms, approved_facts, guidelines, id);

  const updated = db.prepare("SELECT * FROM Brands WHERE id = ?").get(id) as unknown as BrandRecord;
  res.json({ brand: updated });
});

// 5b. Multiformat Content Ingestion (Direct Text, Website URL, PDF, Image)
app.post(
  "/api/ingest",
  (req: Request, res: Response, next: NextFunction) => {
    const contentType = (req.headers["content-type"] || "").toLowerCase();
    if (contentType.includes("multipart/form-data")) {
      uploadMiddleware.single("file")(req, res, (err: unknown) => {
        if (err) {
          if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
              res.status(400).json({ success: false, error: "File size exceeds the 10 MB maximum limit." });
              return;
            }
            res.status(400).json({ success: false, error: err.message });
            return;
          }
          res.status(400).json({
            success: false,
            error: err instanceof Error ? err.message : "File upload failed.",
          });
          return;
        }
        next();
      });
      return;
    }
    next();
  },
  async (req: Request, res: Response) => {
    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    try {
      const body = req.body ?? {};
      const sourceType = typeof body.source_type === "string" ? body.source_type.trim().toLowerCase() : "";

      if (uploadedFile) {
        const result = await ingestUploadedFile({
          filePath: uploadedFile.path,
          originalName: uploadedFile.originalname || "uploaded-file",
          mimeType: uploadedFile.mimetype || "",
          size: uploadedFile.size,
          requestedSourceType: sourceType || undefined,
        });
        res.json(result);
        return;
      }

      if (sourceType === "url" || (typeof body.url === "string" && body.url.trim() && !body.text && !body.content)) {
        const targetUrl = typeof body.url === "string" ? body.url : "";
        if (!targetUrl.trim()) {
          res.status(400).json({ success: false, error: "Please enter a webpage URL to extract." });
          return;
        }
        const result = await ingestWebsiteUrl(targetUrl);
        res.json(result);
        return;
      }

      if (sourceType === "pdf" || sourceType === "image") {
        res.status(400).json({
          success: false,
          error: `Please attach a ${sourceType === "pdf" ? "PDF" : "PNG/JPG/JPEG"} file to extract.`,
        });
        return;
      }

      const rawText =
        typeof body.text === "string"
          ? body.text
          : typeof body.content === "string"
            ? body.content
            : "";
      const sourceName =
        typeof body.source_name === "string" && body.source_name.trim()
          ? body.source_name.trim()
          : "Direct Text Input";
      const result = ingestDirectText(rawText, sourceName);
      res.json(result);
    } catch (err) {
      if (err instanceof IngestionError) {
        res.status(err.statusCode).json({ success: false, error: err.message });
        return;
      }
      console.error("POST /api/ingest error:", err);
      res.status(500).json({
        success: false,
        error: "Failed to ingest content. Please try again.",
      });
    } finally {
      if (uploadedFile?.path) {
        await fsp.unlink(uploadedFile.path).catch(() => {});
      }
    }
  }
);

// 6. Analyse submitted content (Module 2 Multilingual API Contract)
app.post("/api/analyze", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const brand_id = Number(body.brand_id);
    const rawContent = typeof body.content === "string" ? body.content.trim() : "";
    const source_type =
      typeof body.source_type === "string" && body.source_type.trim()
        ? body.source_type.trim()
        : "text";
    const content_type =
      typeof body.content_type === "string" && body.content_type.trim()
        ? body.content_type.trim()
        : source_type === "text"
          ? "General Text"
          : source_type.toUpperCase();

    const defaultTitle =
      rawContent.length > 0
        ? `${source_type.toUpperCase()} Check — ${rawContent.slice(0, 42)}${rawContent.length > 42 ? "..." : ""}`
        : "";
    const title =
      typeof body.title === "string" && body.title.trim() ? body.title.trim() : defaultTitle;

    const detectedLanguageHint =
      typeof body.detected_language === "string" ? body.detected_language.trim() : undefined;
    const forceDemo = Boolean(body.force_demo);

    if (!Number.isInteger(brand_id) || brand_id <= 0) {
      res.status(400).json({ error: "Please select a valid brand." });
      return;
    }
    if (!rawContent) {
      res.status(400).json({ error: "Content cannot be empty. Please provide text to analyse." });
      return;
    }
    if (rawContent.length < 5) {
      res.status(400).json({ error: "Please provide marketing content to analyse (minimum 5 characters)." });
      return;
    }

    const brand = db.prepare("SELECT * FROM Brands WHERE id = ?").get(brand_id) as unknown as BrandRecord | undefined;
    if (!brand) {
      res.status(404).json({ error: "Selected brand not found." });
      return;
    }

    const analysis = await analyzeContentWithAI(brand, title, content_type, rawContent, {
      sourceType: source_type,
      detectedLanguage: detectedLanguageHint,
      forceDemo,
    });

    const insertContent = db.prepare(`
      INSERT INTO Content (
        brand_id, title, content_type, source_type, detected_language,
        original_content, corrected_content, final_content,
        analysis_status, approval_status, analysis_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Review', ?)
    `);

    const contentResult = insertContent.run(
      brand_id,
      title,
      content_type,
      source_type,
      analysis.detected_language,
      rawContent,
      analysis.corrected_content,
      analysis.corrected_content,
      analysis.overall_status,
      analysis.mode
    );

    const contentId = Number(contentResult.lastInsertRowid);

    const insertIssue = db.prepare(`
      INSERT INTO AnalysisResults (
        content_id, issue_id, issue_type, severity, original_text, brand_rule,
        explanation, suggested_correction, rule_reference, confidence, classification
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const issue of analysis.issues) {
      insertIssue.run(
        contentId,
        issue.issue_id,
        issue.type,
        issue.severity,
        issue.original_text,
        issue.brand_rule,
        issue.explanation,
        issue.suggestion,
        issue.rule_reference,
        issue.confidence,
        issue.classification
      );
    }

    const savedContent = db.prepare("SELECT * FROM Content WHERE id = ?").get(contentId) as unknown as ContentRecord;
    const normalizedIssues = getHydratedIssues(contentId);

    res.status(201).json({
      overall_status: savedContent.analysis_status,
      detected_language: savedContent.detected_language,
      source_type: savedContent.source_type,
      corrected_content: savedContent.corrected_content,
      content: savedContent,
      brand,
      issues: normalizedIssues,
      analysis_mode: analysis.mode,
      fallback_reason: analysis.fallback_reason,
    });
  } catch (err) {
    console.error("POST /api/analyze error:", err);
    res.status(500).json({ error: "Failed to analyse content. Please try again." });
  }
});

function getHydratedIssues(contentId: number) {
  const rows = db
    .prepare(`
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
    `)
    .all(contentId) as unknown as Array<
    AnalysisResultRecord & {
      review_record_id: number | null;
      decision: "pending" | "accepted" | "rejected";
      reviewer_reason: string;
      correction_decision: "pending" | "accepted" | "rejected" | "edited";
      final_corrected_text: string;
      reviewed_at: string | null;
    }
  >;

  return rows.map((row, idx) => ({
    ...row,
    issue_id: row.issue_id || `issue_${String(idx + 1).padStart(3, "0")}`,
    type: row.issue_type,
    suggestion: row.suggested_correction,
  }));
}

// 7. Retrieve analysis history & real database summary counts
app.get("/api/history", (_req: Request, res: Response) => {
  try {
    const items = db
      .prepare(`
        SELECT
          c.*,
          b.brand_name,
          (SELECT COUNT(*) FROM AnalysisResults ar WHERE ar.content_id = c.id) AS issue_count
        FROM Content c
        JOIN Brands b ON b.id = c.brand_id
        ORDER BY c.id DESC
      `)
      .all();

    const stats = db
      .prepare(`
        SELECT
          COUNT(*) AS total_analyzed,
          SUM(CASE WHEN analysis_status = 'Compliant' THEN 1 ELSE 0 END) AS compliant_count,
          SUM(CASE WHEN analysis_status = 'Needs Review' THEN 1 ELSE 0 END) AS needs_review_count,
          SUM(CASE WHEN analysis_status = 'Non-Compliant' THEN 1 ELSE 0 END) AS non_compliant_count,
          SUM(CASE WHEN approval_status = 'Pending Review' THEN 1 ELSE 0 END) AS pending_approval_count,
          SUM(CASE WHEN approval_status IN ('Approved Original', 'Approved Corrected') THEN 1 ELSE 0 END) AS approved_count,
          SUM(CASE WHEN approval_status = 'Rejected' THEN 1 ELSE 0 END) AS rejected_count
        FROM Content
      `)
      .get();

    res.json({ items, stats });
  } catch (err) {
    console.error("GET /api/history error:", err);
    res.status(500).json({ error: "Failed to retrieve analysis history." });
  }
});

// 7b. Reset analysis history (preserves brand profiles & guidelines)
app.delete("/api/history", (_req: Request, res: Response) => {
  try {
    const countRow = db.prepare("SELECT COUNT(*) AS count FROM Content").get() as { count: number };
    db.exec(`
      BEGIN;
      DELETE FROM IssueReviews;
      DELETE FROM AnalysisResults;
      DELETE FROM Content;
      COMMIT;
    `);
    res.json({
      success: true,
      deleted_count: countRow?.count ?? 0,
      stats: {
        total_analyzed: 0,
        compliant_count: 0,
        needs_review_count: 0,
        non_compliant_count: 0,
        pending_approval_count: 0,
        approved_count: 0,
        rejected_count: 0,
      },
    });
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore if not in transaction
    }
    console.error("DELETE /api/history error:", err);
    res.status(500).json({ error: "Failed to reset analysis history." });
  }
});

// 8. Retrieve a specific analysis with persisted issue review decisions
app.get("/api/history/:id", (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid analysis ID." });
    return;
  }

  const content = db.prepare("SELECT * FROM Content WHERE id = ?").get(id) as unknown as ContentRecord | undefined;
  if (!content) {
    res.status(404).json({ error: "Analysis record not found." });
    return;
  }

  const brand = db.prepare("SELECT * FROM Brands WHERE id = ?").get(content.brand_id) as unknown as BrandRecord | undefined;
  const issues = getHydratedIssues(id);

  res.json({ content, brand, issues });
});

// 9. Save individual issue review & correction decision OR legacy content review
app.post("/api/review/:id", (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid ID." });
    return;
  }

  const body = req.body ?? {};
  const isIssueReviewPayload =
    typeof body.decision === "string" ||
    typeof body.correction_decision === "string" ||
    typeof body.final_corrected_text === "string" ||
    typeof body.reviewer_reason === "string";

  if (isIssueReviewPayload) {
    const issue = db
      .prepare("SELECT * FROM AnalysisResults WHERE id = ?")
      .get(id) as unknown as AnalysisResultRecord | undefined;
    if (!issue) {
      res.status(404).json({ error: "Issue record not found." });
      return;
    }

    const existingReview = db
      .prepare("SELECT * FROM IssueReviews WHERE issue_id = ?")
      .get(id) as unknown as IssueReviewRecord | undefined;

    const allowedDecisions = new Set(["pending", "accepted", "rejected"]);
    const decision =
      typeof body.decision === "string" && allowedDecisions.has(body.decision)
        ? (body.decision as "pending" | "accepted" | "rejected")
        : existingReview?.decision ?? "pending";

    const reviewer_reason =
      typeof body.reviewer_reason === "string"
        ? body.reviewer_reason.trim()
        : existingReview?.reviewer_reason ?? "";

    if (decision === "rejected" && typeof body.decision === "string" && !reviewer_reason) {
      res.status(400).json({ error: "A rejection reason is required when rejecting an issue." });
      return;
    }

    const allowedCorrectionDecisions = new Set(["pending", "accepted", "rejected", "edited"]);
    const correction_decision =
      typeof body.correction_decision === "string" &&
      allowedCorrectionDecisions.has(body.correction_decision)
        ? (body.correction_decision as "pending" | "accepted" | "rejected" | "edited")
        : existingReview?.correction_decision ?? "pending";

    let final_corrected_text = existingReview?.final_corrected_text ?? issue.suggested_correction;
    if (typeof body.final_corrected_text === "string") {
      final_corrected_text = body.final_corrected_text.trim();
    } else if (correction_decision === "accepted") {
      final_corrected_text = issue.suggested_correction;
    } else if (correction_decision === "rejected") {
      final_corrected_text = issue.original_text;
    }

    db.prepare(`
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
    `).run(
      id,
      issue.content_id,
      decision,
      reviewer_reason,
      correction_decision,
      final_corrected_text
    );

    const saved = db.prepare("SELECT * FROM IssueReviews WHERE issue_id = ?").get(id);
    const hydratedIssues = getHydratedIssues(issue.content_id);
    res.json({ review: saved, issues: hydratedIssues });
    return;
  }

  // Legacy content-level review fallback for existing ReviewPage
  const existing = db.prepare("SELECT * FROM Content WHERE id = ?").get(id) as unknown as ContentRecord | undefined;
  if (!existing) {
    res.status(404).json({ error: "Content record not found." });
    return;
  }

  const allowedStatuses = new Set(["Pending Review", "Approved Original", "Approved Corrected", "Rejected"]);
  const approval_status =
    typeof body.approval_status === "string" && allowedStatuses.has(body.approval_status)
      ? body.approval_status
      : existing.approval_status;

  const corrected_content =
    typeof body.corrected_content === "string" ? body.corrected_content : existing.corrected_content;

  let final_content = existing.final_content;
  if (typeof body.final_content === "string") {
    final_content = body.final_content;
  } else if (approval_status === "Approved Original") {
    final_content = existing.original_content;
  } else if (approval_status === "Approved Corrected") {
    final_content = corrected_content;
  }

  const review_notes = typeof body.review_notes === "string" ? body.review_notes.trim() : existing.review_notes;

  db.prepare(`
    UPDATE Content
    SET approval_status = ?, corrected_content = ?, final_content = ?, review_notes = ?
    WHERE id = ?
  `).run(approval_status, corrected_content, final_content, review_notes, id);

  const updated = db.prepare("SELECT * FROM Content WHERE id = ?").get(id) as unknown as ContentRecord;
  res.json({ content: updated });
});

// 10. Module 3 Final Content Approval endpoint
app.post("/api/approve-content/:content_id", (req: Request, res: Response) => {
  const contentId = parseId(req.params.content_id);
  if (!contentId) {
    res.status(400).json({ error: "Invalid content ID." });
    return;
  }

  const existing = db.prepare("SELECT * FROM Content WHERE id = ?").get(contentId) as unknown as ContentRecord | undefined;
  if (!existing) {
    res.status(404).json({ error: "Content record not found." });
    return;
  }

  const body = req.body ?? {};
  const allowedStatuses = new Set(["Pending Review", "Approved Original", "Approved Corrected", "Rejected"]);
  const approval_status =
    typeof body.approval_status === "string" && allowedStatuses.has(body.approval_status)
      ? body.approval_status
      : "Approved Corrected";

  const corrected_content =
    typeof body.corrected_content === "string" ? body.corrected_content : existing.corrected_content;

  const final_content =
    typeof body.final_content === "string" && body.final_content.trim()
      ? body.final_content
      : approval_status === "Approved Original"
        ? existing.original_content
        : corrected_content || existing.original_content;

  const review_notes =
    typeof body.review_notes === "string" ? body.review_notes.trim() : existing.review_notes;

  db.prepare(`
    UPDATE Content
    SET approval_status = ?, corrected_content = ?, final_content = ?, review_notes = ?
    WHERE id = ?
  `).run(approval_status, corrected_content, final_content, review_notes, contentId);

  const updated = db.prepare("SELECT * FROM Content WHERE id = ?").get(contentId) as unknown as ContentRecord;
  res.json({ content: updated });
});

function formatSuggestionRow(row: GuidelineSuggestionRecord) {
  let related: unknown[] = [];
  try {
    related = JSON.parse(row.related_decisions || "[]");
  } catch {
    related = [];
  }
  return {
    ...row,
    related_decisions: related,
  };
}

// 11. Generate proposed brand guideline improvements from saved human review feedback
app.post("/api/guidelines/suggestions", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const brand_id = Number(body.brand_id);
    if (!Number.isInteger(brand_id) || brand_id <= 0) {
      res.status(400).json({ error: "Valid brand_id is required." });
      return;
    }

    const brand = db.prepare("SELECT * FROM Brands WHERE id = ?").get(brand_id) as unknown as BrandRecord | undefined;
    if (!brand) {
      res.status(404).json({ error: "Brand not found." });
      return;
    }

    const joinedReviews = db
      .prepare(`
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
      `)
      .all(brand_id) as unknown as JoinedReviewDecision[];

    if (joinedReviews.length === 0) {
      const existing = db
        .prepare("SELECT * FROM GuidelineSuggestions WHERE brand_id = ? ORDER BY id DESC")
        .all(brand_id) as unknown as GuidelineSuggestionRecord[];
      res.json({
        suggestions: existing.map(formatSuggestionRow),
        generated_count: 0,
        message: "Accept or reject at least one detected issue first so BrandLens can learn from reviewer feedback.",
      });
      return;
    }

    const { suggestions: generated, mode } = await generateGuidelineSuggestions(brand, joinedReviews);

    const existingPending = db
      .prepare("SELECT existing_guideline, proposed_guideline FROM GuidelineSuggestions WHERE brand_id = ? AND status = 'pending'")
      .all(brand_id) as Array<{ existing_guideline: string; proposed_guideline: string }>;

    let insertedCount = 0;
    const insertStmt = db.prepare(`
      INSERT INTO GuidelineSuggestions (
        brand_id, target_field, existing_guideline, proposed_guideline, reason, related_decisions, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);

    for (const item of generated) {
      const isDuplicate = existingPending.some(
        (p) =>
          p.existing_guideline.trim() === item.existing_guideline.trim() &&
          p.proposed_guideline.trim() === item.proposed_guideline.trim()
      );
      if (isDuplicate) continue;

      insertStmt.run(
        brand_id,
        item.target_field,
        item.existing_guideline,
        item.proposed_guideline,
        item.reason,
        JSON.stringify(item.related_decisions)
      );
      insertedCount++;
    }

    const allSuggestions = db
      .prepare("SELECT * FROM GuidelineSuggestions WHERE brand_id = ? ORDER BY id DESC")
      .all(brand_id) as unknown as GuidelineSuggestionRecord[];

    res.status(201).json({
      suggestions: allSuggestions.map(formatSuggestionRow),
      generated_count: insertedCount,
      mode,
    });
  } catch (err) {
    console.error("POST /api/guidelines/suggestions error:", err);
    res.status(500).json({ error: "Failed to generate guideline suggestions." });
  }
});

// 12. Get guideline improvement suggestions for a brand
app.get("/api/guidelines/suggestions/:brand_id", (req: Request, res: Response) => {
  const brandId = parseId(req.params.brand_id);
  if (!brandId) {
    res.status(400).json({ error: "Invalid brand ID." });
    return;
  }

  const rows = db
    .prepare("SELECT * FROM GuidelineSuggestions WHERE brand_id = ? ORDER BY id DESC")
    .all(brandId) as unknown as GuidelineSuggestionRecord[];

  res.json({ suggestions: rows.map(formatSuggestionRow) });
});

// 13. Explicitly approve a proposed guideline change and update permanent brand guidelines
app.post("/api/guidelines/suggestions/:id/approve", (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid suggestion ID." });
    return;
  }

  const suggestion = db
    .prepare("SELECT * FROM GuidelineSuggestions WHERE id = ?")
    .get(id) as unknown as GuidelineSuggestionRecord | undefined;
  if (!suggestion) {
    res.status(404).json({ error: "Guideline suggestion not found." });
    return;
  }

  const body = req.body ?? {};
  const proposedText =
    typeof body.proposed_guideline === "string" && body.proposed_guideline.trim()
      ? body.proposed_guideline.trim()
      : suggestion.proposed_guideline;

  const allowedFields = new Set([
    "tone",
    "preferred_terms",
    "prohibited_terms",
    "approved_facts",
    "guidelines",
  ]);
  const targetField = allowedFields.has(suggestion.target_field)
    ? suggestion.target_field
    : "guidelines";

  db.prepare(`
    UPDATE GuidelineSuggestions
    SET status = 'approved', proposed_guideline = ?, approved_at = datetime('now')
    WHERE id = ?
  `).run(proposedText, id);

  // Only update permanent Brands table after explicit human approval
  db.prepare(`UPDATE Brands SET ${targetField} = ? WHERE id = ?`).run(
    proposedText,
    suggestion.brand_id
  );

  const updatedSuggestion = db
    .prepare("SELECT * FROM GuidelineSuggestions WHERE id = ?")
    .get(id) as unknown as GuidelineSuggestionRecord;
  const updatedBrand = db
    .prepare("SELECT * FROM Brands WHERE id = ?")
    .get(suggestion.brand_id) as unknown as BrandRecord;

  res.json({
    suggestion: formatSuggestionRow(updatedSuggestion),
    brand: updatedBrand,
  });
});

// 14. Reject a proposed guideline change (never modifies permanent brand guidelines)
app.post("/api/guidelines/suggestions/:id/reject", (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid suggestion ID." });
    return;
  }

  const suggestion = db
    .prepare("SELECT * FROM GuidelineSuggestions WHERE id = ?")
    .get(id) as unknown as GuidelineSuggestionRecord | undefined;
  if (!suggestion) {
    res.status(404).json({ error: "Guideline suggestion not found." });
    return;
  }

  const body = req.body ?? {};
  const nextReason =
    typeof body.reason === "string" && body.reason.trim()
      ? `${suggestion.reason} (Rejected note: ${body.reason.trim()})`
      : suggestion.reason;

  db.prepare(`
    UPDATE GuidelineSuggestions
    SET status = 'rejected', reason = ?
    WHERE id = ?
  `).run(nextReason, id);

  const updatedSuggestion = db
    .prepare("SELECT * FROM GuidelineSuggestions WHERE id = ?")
    .get(id) as unknown as GuidelineSuggestionRecord;

  res.json({ suggestion: formatSuggestionRow(updatedSuggestion) });
});

// Vite dev middleware in development, static dist in production
async function startServer(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("/{*splat}", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BrandLens server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start BrandLens server:", err);
  process.exit(1);
});
