import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { db, initDatabase } from "./server/db.ts";
import type { BrandRecord, ContentRecord, AnalysisResultRecord } from "./server/db.ts";
import { analyzeContentWithAI, isGeminiConfigured } from "./server/analyzer.ts";

initDatabase();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));

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

// 6. Analyse submitted content
app.post("/api/analyze", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const brand_id = Number(body.brand_id);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content_type = typeof body.content_type === "string" ? body.content_type.trim() : "General Text";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const forceDemo = Boolean(body.force_demo);

    if (!Number.isInteger(brand_id) || brand_id <= 0) {
      res.status(400).json({ error: "Please select a valid brand." });
      return;
    }
    if (!title) {
      res.status(400).json({ error: "Please enter a content title." });
      return;
    }
    if (!content || content.length < 5) {
      res.status(400).json({ error: "Please provide marketing content to analyse (minimum 5 characters)." });
      return;
    }

    const brand = db.prepare("SELECT * FROM Brands WHERE id = ?").get(brand_id) as unknown as BrandRecord | undefined;
    if (!brand) {
      res.status(404).json({ error: "Selected brand not found." });
      return;
    }

    const analysis = await analyzeContentWithAI(brand, title, content_type, content, forceDemo);

    const insertContent = db.prepare(`
      INSERT INTO Content (
        brand_id, title, content_type, original_content, corrected_content,
        final_content, analysis_status, approval_status, analysis_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Review', ?)
    `);

    const contentResult = insertContent.run(
      brand_id,
      title,
      content_type,
      content,
      analysis.corrected_content,
      analysis.corrected_content,
      analysis.overall_status,
      analysis.mode
    );

    const contentId = Number(contentResult.lastInsertRowid);

    const insertIssue = db.prepare(`
      INSERT INTO AnalysisResults (
        content_id, issue_type, severity, original_text, brand_rule,
        explanation, suggested_correction, rule_reference
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const issue of analysis.issues) {
      insertIssue.run(
        contentId,
        issue.type,
        issue.severity,
        issue.original_text,
        issue.brand_rule,
        issue.explanation,
        issue.suggestion,
        issue.rule_reference
      );
    }

    const savedContent = db.prepare("SELECT * FROM Content WHERE id = ?").get(contentId) as unknown as ContentRecord;
    const savedIssues = db
      .prepare("SELECT * FROM AnalysisResults WHERE content_id = ? ORDER BY id ASC")
      .all(contentId) as unknown as AnalysisResultRecord[];

    res.status(201).json({
      content: savedContent,
      brand,
      issues: savedIssues,
      analysis_mode: analysis.mode,
      fallback_reason: analysis.fallback_reason,
    });
  } catch (err) {
    console.error("POST /api/analyze error:", err);
    res.status(500).json({ error: "Failed to analyse content. Please try again." });
  }
});

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

// 8. Retrieve a specific analysis
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
  const issues = db
    .prepare("SELECT * FROM AnalysisResults WHERE content_id = ? ORDER BY id ASC")
    .all(id) as unknown as AnalysisResultRecord[];

  res.json({ content, brand, issues });
});

// 9. Save human review decision (approval or rejection) or updated corrected draft
app.post("/api/review/:id", (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid content ID." });
    return;
  }

  const existing = db.prepare("SELECT * FROM Content WHERE id = ?").get(id) as unknown as ContentRecord | undefined;
  if (!existing) {
    res.status(404).json({ error: "Content record not found." });
    return;
  }

  const body = req.body ?? {};
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
