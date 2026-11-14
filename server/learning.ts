import { GoogleGenAI, Type } from "@google/genai";
import type { BrandRecord } from "./db.ts";
import { isGeminiConfigured } from "./analyzer.ts";

export interface JoinedReviewDecision {
  review_id: number;
  issue_db_id: number;
  issue_key: string;
  content_id: number;
  content_type: string;
  issue_type: string;
  severity: string;
  original_text: string;
  brand_rule: string;
  suggested_correction: string;
  decision: "pending" | "accepted" | "rejected";
  reviewer_reason: string;
  correction_decision: "pending" | "accepted" | "rejected" | "edited";
  final_corrected_text: string;
  reviewed_at: string;
}

export interface GeneratedSuggestion {
  target_field: "tone" | "preferred_terms" | "prohibited_terms" | "approved_facts" | "guidelines";
  existing_guideline: string;
  proposed_guideline: string;
  reason: string;
  related_decisions: Array<{
    review_id: number;
    issue_id: number;
    issue_type: string;
    decision: string;
    original_text: string;
    reviewer_reason: string;
  }>;
}

const ALLOWED_FIELDS = new Set([
  "tone",
  "preferred_terms",
  "prohibited_terms",
  "approved_facts",
  "guidelines",
]);

function normalizeTargetField(
  value: unknown
): "tone" | "preferred_terms" | "prohibited_terms" | "approved_facts" | "guidelines" {
  if (typeof value === "string" && ALLOWED_FIELDS.has(value)) {
    return value as "tone" | "preferred_terms" | "prohibited_terms" | "approved_facts" | "guidelines";
  }
  return "guidelines";
}

function getFieldValue(
  brand: BrandRecord,
  field: "tone" | "preferred_terms" | "prohibited_terms" | "approved_facts" | "guidelines"
): string {
  return brand[field] || "";
}

function toDecisionSummary(r: JoinedReviewDecision) {
  return {
    review_id: r.review_id,
    issue_id: r.issue_db_id,
    issue_type: r.issue_type,
    decision: r.decision,
    original_text: r.original_text,
    reviewer_reason: r.reviewer_reason,
  };
}

/**
 * Deterministic feedback-based guideline learning fallback when Gemini is unavailable.
 * Analyzes accepted violations, rejected false positives, and manual correction patterns.
 */
export function generateDemoGuidelineSuggestions(
  brand: BrandRecord,
  reviews: JoinedReviewDecision[]
): GeneratedSuggestion[] {
  const suggestions: GeneratedSuggestion[] = [];
  const reviewed = reviews.filter((r) => r.decision === "accepted" || r.decision === "rejected");
  if (reviewed.length === 0) {
    return suggestions;
  }

  // 1. Check rejected false positives (e.g., tone or general guideline exceptions)
  const rejected = reviewed.filter((r) => r.decision === "rejected");
  if (rejected.length > 0) {
    const toneRejections = rejected.filter((r) =>
      r.issue_type.toLowerCase().includes("tone") || r.brand_rule.toLowerCase().includes("tone")
    );
    if (toneRejections.length > 0) {
      const sampleReason = toneRejections.map((r) => r.reviewer_reason).filter(Boolean)[0] ||
        "Conversational phrasing was marked acceptable by reviewers.";
      const existing = brand.tone || "Friendly, modern and professional";
      const proposed = existing.toLowerCase().includes("social")
        ? existing
        : `${existing}; conversational and engaging phrasing is acceptable for social media posts`;
      suggestions.push({
        target_field: "tone",
        existing_guideline: existing,
        proposed_guideline: proposed,
        reason: `Reviewers rejected ${toneRejections.length} tone flag(s) (e.g. "${sampleReason}"). Clarifying channel tone flexibility prevents recurring false positives.`,
        related_decisions: toneRejections.slice(0, 4).map(toDecisionSummary),
      });
    } else {
      const first = rejected[0];
      const existing = brand.guidelines || "Avoid exaggerated marketing claims.";
      const reasonSnippet = first.reviewer_reason || "Reviewer marked this detection as acceptable in context.";
      suggestions.push({
        target_field: "guidelines",
        existing_guideline: existing,
        proposed_guideline: `${existing} Exception note: ${reasonSnippet}`,
        reason: `Reviewer(s) rejected ${rejected.length} AI finding(s) as false positives (${first.issue_type}: "${first.original_text}"). Adding context clarifies acceptable usage.`,
        related_decisions: rejected.slice(0, 4).map(toDecisionSummary),
      });
    }
  }

  // 2. Check frequently accepted violations & repeated content problems
  const accepted = reviewed.filter((r) => r.decision === "accepted");
  if (accepted.length > 0) {
    const prohibitedAccepted = accepted.filter((r) =>
      r.issue_type.toLowerCase().includes("prohibited")
    );
    const unverifiedAccepted = accepted.filter(
      (r) =>
        r.issue_type.toLowerCase().includes("unsupported") ||
        r.issue_type.toLowerCase().includes("unverified")
    );
    const otherAccepted = accepted.filter(
      (r) => !prohibitedAccepted.includes(r) && !unverifiedAccepted.includes(r)
    );

    if (prohibitedAccepted.length > 0) {
      const editedExamples = prohibitedAccepted
        .filter((r) => r.correction_decision === "edited" && r.final_corrected_text)
        .map((r) => `"${r.original_text}" -> "${r.final_corrected_text}"`);
      const flaggedTerms = Array.from(new Set(prohibitedAccepted.map((r) => `"${r.original_text}"`))).slice(0, 3);
      const existing = brand.guidelines || "Avoid exaggerated marketing claims.";
      const extraNote =
        editedExamples.length > 0
          ? ` Use reviewer-approved alternatives such as ${editedExamples[0]}.`
          : ` Strictly replace flagged terms (${flaggedTerms.join(", ")}) with neutral, factual phrasing.`;

      suggestions.push({
        target_field: "guidelines",
        existing_guideline: existing,
        proposed_guideline: `${existing}${extraNote}`,
        reason: `Reviewers confirmed ${prohibitedAccepted.length} prohibited-term violation(s) (${flaggedTerms.join(", ")}). Documenting approved replacement guidance helps writers avoid repeat issues.`,
        related_decisions: prohibitedAccepted.slice(0, 4).map(toDecisionSummary),
      });
    } else if (unverifiedAccepted.length > 0) {
      const existing = brand.approved_facts || "";
      const claimTexts = unverifiedAccepted.map((r) => r.original_text).slice(0, 2);
      suggestions.push({
        target_field: "approved_facts",
        existing_guideline: existing || "No approved facts listed yet.",
        proposed_guideline: existing
          ? `${existing} (Ensure claims such as "${claimTexts.join('", "')}" are verified before publication.)`
          : `Verify factual claims (${claimTexts.join(", ")}) with source documentation before publishing.`,
        reason: `Reviewers confirmed ${unverifiedAccepted.length} unverified factual claim(s). Clarifying approved facts reduces compliance bottlenecks.`,
        related_decisions: unverifiedAccepted.slice(0, 4).map(toDecisionSummary),
      });
    } else if (otherAccepted.length > 0) {
      const first = otherAccepted[0];
      const existing = brand.guidelines || "Maintain clear and accurate brand messaging.";
      const reviewerNote = first.reviewer_reason ? ` Reviewer guidance: ${first.reviewer_reason}` : "";
      suggestions.push({
        target_field: "guidelines",
        existing_guideline: existing,
        proposed_guideline: `${existing} Avoid ${first.issue_type.toLowerCase()} patterns such as "${first.original_text}".${reviewerNote}`,
        reason: `Reviewers accepted ${otherAccepted.length} violation(s) around ${first.issue_type}. Making this explicit improves first-draft compliance.`,
        related_decisions: otherAccepted.slice(0, 4).map(toDecisionSummary),
      });
    }
  }

  return suggestions;
}

/**
 * Generate proposed brand guideline updates from saved human review decisions.
 * Never alters the Brands table directly.
 */
export async function generateGuidelineSuggestions(
  brand: BrandRecord,
  reviews: JoinedReviewDecision[]
): Promise<{ suggestions: GeneratedSuggestion[]; mode: "gemini" | "demo" }> {
  const reviewed = reviews.filter((r) => r.decision === "accepted" || r.decision === "rejected");
  if (reviewed.length === 0) {
    return { suggestions: [], mode: isGeminiConfigured() ? "gemini" : "demo" };
  }

  if (!isGeminiConfigured()) {
    return {
      suggestions: generateDemoGuidelineSuggestions(brand, reviewed),
      mode: "demo",
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const reviewLog = reviewed.slice(0, 25).map((r) => ({
      review_id: r.review_id,
      issue_id: r.issue_db_id,
      content_type: r.content_type,
      issue_type: r.issue_type,
      severity: r.severity,
      original_text: r.original_text,
      brand_rule: r.brand_rule,
      decision: r.decision,
      reviewer_reason: r.reviewer_reason,
      correction_decision: r.correction_decision,
      final_corrected_text: r.final_corrected_text,
    }));

    const prompt = `You are BrandLens's Guideline Learning assistant.
Analyze the saved human review decisions for "${brand.brand_name}" and propose 1 to 3 concise, practical brand guideline improvements.

Rules:
- Identify frequently accepted violations, rejected false positives, repeated content problems, unclear guidelines, or manual correction patterns.
- NEVER invent unrelated rules. Ground every suggestion strictly in the provided review log and current brand fields.
- A rejected AI finding informs clarification/context (e.g., clarifying social media tone flexibility), NOT an automatic new strict rule.
- For each suggestion, choose target_field from: "tone", "preferred_terms", "prohibited_terms", "approved_facts", "guidelines".
- Return exact existing_guideline text from the current brand profile and a clear, actionable proposed_guideline.

=== CURRENT BRAND PROFILE ===
tone: ${brand.tone}
preferred_terms: ${brand.preferred_terms}
prohibited_terms: ${brand.prohibited_terms}
approved_facts: ${brand.approved_facts}
guidelines: ${brand.guidelines}

=== HUMAN REVIEW DECISIONS ===
${JSON.stringify(reviewLog, null, 2)}
`;

    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  target_field: { type: Type.STRING },
                  existing_guideline: { type: Type.STRING },
                  proposed_guideline: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  related_review_ids: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                  },
                },
                required: [
                  "target_field",
                  "existing_guideline",
                  "proposed_guideline",
                  "reason",
                  "related_review_ids",
                ],
              },
            },
          },
          required: ["suggestions"],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? "{}").trim()) as {
      suggestions?: Array<Record<string, unknown>>;
    };

    const rawList = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const byReviewId = new Map(reviewed.map((r) => [r.review_id, r]));

    const mapped: GeneratedSuggestion[] = rawList
      .filter((s) => typeof s.proposed_guideline === "string" && s.proposed_guideline.trim())
      .slice(0, 3)
      .map((s) => {
        const target_field = normalizeTargetField(s.target_field);
        const ids = Array.isArray(s.related_review_ids)
          ? s.related_review_ids.map((n) => Number(n)).filter((n) => byReviewId.has(n))
          : [];
        const matchedReviews =
          ids.length > 0 ? ids.map((id) => byReviewId.get(id)!) : reviewed.slice(0, 3);

        return {
          target_field,
          existing_guideline:
            getFieldValue(brand, target_field) ||
            (typeof s.existing_guideline === "string" ? s.existing_guideline.trim() : ""),
          proposed_guideline: String(s.proposed_guideline).trim(),
          reason:
            typeof s.reason === "string" && s.reason.trim()
              ? s.reason.trim()
              : "Derived from saved reviewer decisions.",
          related_decisions: matchedReviews.map(toDecisionSummary),
        };
      });

    if (mapped.length === 0) {
      return {
        suggestions: generateDemoGuidelineSuggestions(brand, reviewed),
        mode: "demo",
      };
    }

    return { suggestions: mapped, mode: "gemini" };
  } catch (err) {
    console.warn("Gemini guideline learning fallback:", err);
    return {
      suggestions: generateDemoGuidelineSuggestions(brand, reviewed),
      mode: "demo",
    };
  }
}
