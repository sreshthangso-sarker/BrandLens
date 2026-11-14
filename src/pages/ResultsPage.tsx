import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Lightbulb,
  RotateCcw,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import type {
  AnalysisDetailResponse,
  AnalysisIssue,
  ApprovalStatus,
  Brand,
  CorrectionDecision,
  GuidelineSuggestion,
  GuidelineTargetField,
  HistoryItem,
  IssueDecision,
  PageView,
} from "../types.ts";
import { api } from "../services/api.ts";
import { computeWordDiff } from "../utils/diff.ts";
import {
  AnalysisStatusLabel,
  ApprovalStatusLabel,
} from "../components/StatusIndicator.tsx";

interface ResultsPageProps {
  detail: AnalysisDetailResponse | null;
  historyItems: HistoryItem[];
  loading: boolean;
  onSelectAnalysis: (id: number) => void;
  onSaveDraftCorrection: (
    id: number,
    correctedContent: string,
    finalContent: string
  ) => Promise<void>;
  onReviewIssue: (
    issueDbId: number,
    payload: {
      decision?: IssueDecision;
      reviewer_reason?: string;
      correction_decision?: CorrectionDecision;
      final_corrected_text?: string;
    }
  ) => Promise<void>;
  onApproveContent: (
    contentId: number,
    payload: {
      approval_status: ApprovalStatus;
      corrected_content: string;
      final_content: string;
      review_notes?: string;
    }
  ) => Promise<void>;
  onBrandUpdated: (brand: Brand) => void;
  onNavigate: (page: PageView) => void;
}

const TARGET_FIELD_LABELS: Record<GuidelineTargetField, string> = {
  tone: "Preferred Tone",
  preferred_terms: "Preferred Terminology",
  prohibited_terms: "Prohibited Terms",
  approved_facts: "Approved Facts & Claims",
  guidelines: "General Writing Guidelines",
};

function IssueSeverityText({ severity }: { severity: AnalysisIssue["severity"] }) {
  if (severity === "High") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 whitespace-nowrap">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
        High (Serious)
      </span>
    );
  }
  if (severity === "Medium") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
        Medium (Warning)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 whitespace-nowrap">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-slate-500" />
      Low
    </span>
  );
}

function IssueDecisionStatus({ decision }: { decision?: IssueDecision }) {
  if (decision === "accepted") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        Accepted Violation
      </span>
    );
  }
  if (decision === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
        Rejected Finding
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
      Pending Review
    </span>
  );
}

function CorrectionDecisionStatus({ decision }: { decision?: CorrectionDecision }) {
  if (decision === "accepted") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <Check className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        Correction Accepted
      </span>
    );
  }
  if (decision === "edited") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <Edit3 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        Manually Edited
      </span>
    );
  }
  if (decision === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 whitespace-nowrap">
        <X className="w-3.5 h-3.5 shrink-0 text-rose-600" />
        Correction Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
      Pending
    </span>
  );
}

function IssueReviewCard({
  issue,
  index,
  onSaveReview,
}: {
  issue: AnalysisIssue;
  index: number;
  onSaveReview: (
    issueDbId: number,
    payload: {
      decision?: IssueDecision;
      reviewer_reason?: string;
      correction_decision?: CorrectionDecision;
      final_corrected_text?: string;
    }
  ) => Promise<void>;
}) {
  const [reasonDraft, setReasonDraft] = useState(issue.reviewer_reason ?? "");
  const [showRejectPrompt, setShowRejectPrompt] = useState(false);
  const [editingCorrection, setEditingCorrection] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState(
    issue.final_corrected_text || issue.suggested_correction
  );
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardNote, setCardNote] = useState<string | null>(null);

  useEffect(() => {
    setReasonDraft(issue.reviewer_reason ?? "");
    setCorrectionDraft(issue.final_corrected_text || issue.suggested_correction);
    setShowRejectPrompt(false);
    setEditingCorrection(false);
    setCardError(null);
  }, [issue.id, issue.reviewer_reason, issue.final_corrected_text, issue.suggested_correction]);

  const handleAcceptIssue = async () => {
    setSaving(true);
    setCardError(null);
    setCardNote(null);
    setShowRejectPrompt(false);
    try {
      await onSaveReview(issue.id, {
        decision: "accepted",
        reviewer_reason: reasonDraft.trim(),
      });
      setCardNote("Issue confirmed. Review its suggested correction independently below.");
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Failed to accept issue.");
    } finally {
      setSaving(false);
    }
  };

  const handleRejectIssueSubmit = async () => {
    if (!reasonDraft.trim()) {
      setCardError("A rejection reason is required before rejecting an issue.");
      return;
    }
    setSaving(true);
    setCardError(null);
    setCardNote(null);
    try {
      await onSaveReview(issue.id, {
        decision: "rejected",
        reviewer_reason: reasonDraft.trim(),
      });
      setShowRejectPrompt(false);
      setCardNote("Issue rejected with reason saved for guideline learning.");
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Failed to reject issue.");
    } finally {
      setSaving(false);
    }
  };

  const handleCorrectionDecision = async (
    nextDecision: CorrectionDecision,
    customText?: string
  ) => {
    setSaving(true);
    setCardError(null);
    setCardNote(null);
    try {
      const nextText =
        nextDecision === "accepted"
          ? issue.suggested_correction
          : nextDecision === "rejected"
            ? issue.original_text
            : (customText ?? correctionDraft).trim();

      if (nextDecision === "edited" && !nextText) {
        setCardError("Please enter replacement text before saving a manual edit.");
        setSaving(false);
        return;
      }

      await onSaveReview(issue.id, {
        correction_decision: nextDecision,
        final_corrected_text: nextText,
      });
      setEditingCorrection(false);
      setCardNote(
        nextDecision === "accepted"
          ? "Suggested correction accepted."
          : nextDecision === "rejected"
            ? "Suggested correction rejected (original phrasing retained)."
            : "Manual correction saved."
      );
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Failed to update correction decision.");
    } finally {
      setSaving(false);
    }
  };

  const activeReplacement =
    issue.correction_decision === "rejected"
      ? issue.original_text
      : issue.final_corrected_text || issue.suggested_correction;

  return (
    <article
      data-testid={`issue-card-${issue.id}`}
      className="bg-white border border-[#E5E7F0] rounded-xl p-5 space-y-4"
    >
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-slate-500 tabular-nums">
            {issue.issue_id || `issue_${String(index + 1).padStart(3, "0")}`}
          </span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="text-sm font-semibold text-[#141A2E]">{issue.issue_type}</span>
          {typeof issue.confidence === "number" && (
            <>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-500">
                Confidence {Math.round(issue.confidence * 100)}%
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <IssueSeverityText severity={issue.severity} />
          <IssueDecisionStatus decision={issue.decision} />
        </div>
      </div>

      {/* Original Text vs Relevant Brand Guideline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="bg-[#F7F8FC] border border-[#E5E7F0] rounded-lg p-3.5 space-y-1">
          <div className="font-semibold text-slate-500">Original Problematic Text</div>
          <div className="text-sm text-rose-800 font-medium break-words">
            &ldquo;{issue.original_text}&rdquo;
          </div>
        </div>
        <div className="bg-[#F7F8FC] border border-[#E5E7F0] rounded-lg p-3.5 space-y-1">
          <div className="font-semibold text-slate-500">Relevant Brand Guideline</div>
          <div className="text-sm text-[#141A2E]">{issue.brand_rule}</div>
        </div>
      </div>

      {/* AI Explanation */}
      <div className="text-xs leading-relaxed text-slate-600">
        <span className="font-semibold text-[#141A2E]">AI Explanation: </span>
        {issue.explanation}
      </div>

      {/* Step 1: Individual Issue Review */}
      <div className="pt-3 border-t border-[#E5E7F0] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs font-semibold text-[#141A2E]">
            1. Issue Detection Review
            <span className="font-normal text-slate-500 ml-2">
              Confirm whether this finding is a real guideline violation.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={handleAcceptIssue}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                issue.decision === "accepted"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-[#D5D9E6] bg-white hover:bg-slate-50 text-[#141A2E]"
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              Accept Issue
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setShowRejectPrompt(true);
                setCardError(null);
              }}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                issue.decision === "rejected"
                  ? "border-rose-300 bg-rose-50 text-rose-800"
                  : "border-[#D5D9E6] bg-white hover:bg-slate-50 text-slate-700"
              }`}
            >
              <X className="w-3.5 h-3.5" />
              Reject Issue
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            placeholder={
              showRejectPrompt
                ? "Required: explain why this finding is incorrect or acceptable..."
                : "Optional explanation when accepting, or required reason when rejecting..."
            }
            aria-label={`Reviewer reason for issue ${index + 1}`}
            className="flex-1 px-3 py-2 rounded-lg border border-[#D5D9E6] bg-white text-xs text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
          />
          {showRejectPrompt && (
            <button
              type="button"
              disabled={saving}
              onClick={handleRejectIssueSubmit}
              className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              Confirm Rejection
            </button>
          )}
        </div>
      </div>

      {/* Step 2: Correction Review (Independent of Issue Acceptance) */}
      <div className="pt-3 border-t border-[#E5E7F0] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#141A2E]">
              2. Correction Review
            </span>
            <CorrectionDecisionStatus decision={issue.correction_decision} />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleCorrectionDecision("accepted")}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                issue.correction_decision === "accepted"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-[#D5D9E6] bg-white hover:bg-slate-50 text-[#141A2E]"
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              Accept Correction
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleCorrectionDecision("rejected")}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                issue.correction_decision === "rejected"
                  ? "border-rose-300 bg-rose-50 text-rose-800"
                  : "border-[#D5D9E6] bg-white hover:bg-slate-50 text-slate-700"
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reject Correction
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setCorrectionDraft(issue.final_corrected_text || issue.suggested_correction);
                setEditingCorrection((prev) => !prev);
              }}
              className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Edit3 className="w-3.5 h-3.5" />
              {editingCorrection ? "Cancel Edit" : "Edit Manually"}
            </button>
          </div>
        </div>

        {/* Original vs Replacement Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-[#E5E7F0] bg-[#F7F8FC]/60 p-3">
            <div className="font-medium text-slate-500 mb-1">Original</div>
            <div className="text-slate-700">{issue.original_text}</div>
          </div>
          <div className="rounded-lg border border-[#E5E7F0] bg-emerald-50/40 p-3">
            <div className="font-medium text-emerald-800 mb-1">
              {issue.correction_decision === "edited"
                ? "Reviewer Edited Correction"
                : issue.correction_decision === "rejected"
                  ? "Retained Original (Correction Rejected)"
                  : "Suggested Correction"}
            </div>
            <div className="text-[#141A2E] font-medium">{activeReplacement}</div>
          </div>
        </div>

        {editingCorrection && (
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <input
              type="text"
              value={correctionDraft}
              onChange={(e) => setCorrectionDraft(e.target.value)}
              aria-label={`Manual correction for issue ${index + 1}`}
              className="flex-1 px-3 py-2 rounded-lg border border-[#D5D9E6] bg-white text-xs text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => handleCorrectionDecision("edited", correctionDraft)}
              className="px-3.5 py-2 rounded-lg bg-[#6B5CE7] hover:bg-[#5A4BD6] text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              Save Manual Correction
            </button>
          </div>
        )}
      </div>

      {cardError && (
        <div role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {cardError}
        </div>
      )}
      {cardNote && !cardError && (
        <div role="status" className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {cardNote}
        </div>
      )}
    </article>
  );
}

function SuggestionCard({
  suggestion,
  onApprove,
  onReject,
}: {
  suggestion: GuidelineSuggestion;
  onApprove: (id: number, editedProposed: string) => Promise<void>;
  onReject: (id: number) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [proposedDraft, setProposedDraft] = useState(suggestion.proposed_guideline);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProposedDraft(suggestion.proposed_guideline);
    setIsEditing(false);
  }, [suggestion.id, suggestion.proposed_guideline]);

  const statusColor =
    suggestion.status === "approved"
      ? "text-emerald-700"
      : suggestion.status === "rejected"
        ? "text-rose-700"
        : "text-slate-600";

  const statusLabel =
    suggestion.status === "approved"
      ? "Approved & Applied"
      : suggestion.status === "rejected"
        ? "Rejected"
        : "Pending Human Approval";

  return (
    <div
      data-testid={`suggestion-card-${suggestion.id}`}
      className="border border-[#E5E7F0] rounded-xl p-5 bg-white space-y-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-[#141A2E]">
            {TARGET_FIELD_LABELS[suggestion.target_field] ?? suggestion.target_field}
          </span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
        </div>
        <span className="text-[11px] font-mono text-slate-400 tabular-nums">
          Suggestion #{suggestion.id}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
        <div className="bg-[#F7F8FC] border border-[#E5E7F0] rounded-lg p-3 space-y-1">
          <div className="font-semibold text-slate-500">Existing Guideline</div>
          <div className="text-slate-700 whitespace-pre-wrap">
            {suggestion.existing_guideline || "(Not yet specified)"}
          </div>
        </div>
        <div className="bg-emerald-50/40 border border-emerald-200/70 rounded-lg p-3 space-y-1">
          <div className="font-semibold text-emerald-800">Proposed Guideline Change</div>
          {isEditing ? (
            <textarea
              rows={3}
              value={proposedDraft}
              onChange={(e) => setProposedDraft(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-[#D5D9E6] bg-white text-xs text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            />
          ) : (
            <div className="text-[#141A2E] font-medium whitespace-pre-wrap">
              {proposedDraft}
            </div>
          )}
        </div>
      </div>

      <div className="text-xs text-slate-600 leading-relaxed">
        <span className="font-semibold text-[#141A2E]">Reason for Suggestion: </span>
        {suggestion.reason}
      </div>

      {suggestion.related_decisions && suggestion.related_decisions.length > 0 && (
        <div className="bg-[#F7F8FC] rounded-lg p-3 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-500">
            Related Review Decisions ({suggestion.related_decisions.length})
          </div>
          <ul className="space-y-1 text-xs text-slate-600">
            {suggestion.related_decisions.slice(0, 4).map((rel, idx) => (
              <li key={idx} className="flex flex-wrap items-baseline gap-1.5">
                <span
                  className={
                    rel.decision === "accepted"
                      ? "font-semibold text-emerald-700"
                      : "font-semibold text-rose-700"
                  }
                >
                  [{rel.decision.toUpperCase()}]
                </span>
                <span className="text-[#141A2E] font-medium">{rel.issue_type}:</span>
                <span>&ldquo;{rel.original_text}&rdquo;</span>
                {rel.reviewer_reason && (
                  <span className="text-slate-500">— {rel.reviewer_reason}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestion.status === "pending" && (
        <div className="pt-2 border-t border-[#E5E7F0] flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setIsEditing((prev) => !prev)}
            className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Edit3 className="w-3.5 h-3.5" />
            {isEditing ? "Preview Change" : "Edit Proposed Guideline"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onReject(suggestion.id);
              } finally {
                setBusy(false);
              }
            }}
            className="px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5" />
            Reject Update
          </button>
          <button
            type="button"
            disabled={busy || !proposedDraft.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onApprove(suggestion.id, proposedDraft.trim());
              } finally {
                setBusy(false);
              }
            }}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Check className="w-3.5 h-3.5" />
            Approve Guideline Update
          </button>
        </div>
      )}
    </div>
  );
}

export function ResultsPage({
  detail,
  historyItems,
  loading,
  onSelectAnalysis,
  onSaveDraftCorrection,
  onReviewIssue,
  onApproveContent,
  onBrandUpdated,
  onNavigate,
}: ResultsPageProps) {
  const [isEditingFinal, setIsEditingFinal] = useState(false);
  const [finalDraft, setFinalDraft] = useState("");
  const [savingFinal, setSavingFinal] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<GuidelineSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null);

  const brandId = detail?.brand?.id;

  const fetchSuggestions = useCallback(async (id: number) => {
    setLoadingSuggestions(true);
    try {
      const res = await api.getGuidelineSuggestions(id);
      setSuggestions(res.suggestions);
    } catch {
      // Keep page functional even if initial suggestion fetch fails
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  useEffect(() => {
    if (detail) {
      setFinalDraft(
        detail.content.final_content ||
          detail.content.corrected_content ||
          detail.content.original_content
      );
      setIsEditingFinal(false);
      setFeedback(null);
      setError(null);
      setSuggestionNotice(null);
    }
  }, [detail?.content.id, detail?.content.final_content, detail?.content.corrected_content]);

  useEffect(() => {
    if (brandId) {
      fetchSuggestions(brandId);
    }
  }, [brandId, fetchSuggestions]);

  const diff = useMemo(() => {
    if (!detail) return { originalSegments: [], correctedSegments: [] };
    return computeWordDiff(detail.content.original_content, finalDraft);
  }, [detail, finalDraft]);

  if (loading) {
    return (
      <div className="bg-white border border-[#E5E7F0] rounded-xl p-8 space-y-4">
        <div className="h-6 w-1/3 bg-slate-100 rounded animate-pulse" />
        <div className="h-32 bg-slate-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="bg-white border border-[#E5E7F0] rounded-xl p-10 text-center space-y-3">
        <h2 className="text-base font-semibold text-[#141A2E]">No analysis selected</h2>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Submit content in the Content Checker or select a previous analysis from History to inspect and review individual guideline findings.
        </p>
        <div className="pt-2 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate("checker")}
            className="px-4 py-2 rounded-lg bg-[#6B5CE7] hover:bg-[#5A4BD6] text-white text-xs font-medium transition-colors"
          >
            Go to Content Checker
          </button>
          {historyItems.length > 0 && (
            <button
              type="button"
              onClick={() => onSelectAnalysis(historyItems[0].id)}
              className="px-4 py-2 rounded-lg border border-[#D5D9E6] text-xs font-medium text-[#141A2E] hover:bg-slate-50"
            >
              Load Latest Analysis
            </button>
          )}
        </div>
      </div>
    );
  }

  const { content, brand, issues, fallback_reason } = detail;
  const highCount = issues.filter((i) => i.severity === "High").length;
  const mediumCount = issues.filter((i) => i.severity === "Medium").length;
  const lowCount = issues.filter((i) => i.severity === "Low").length;
  const reviewedCount = issues.filter(
    (i) => i.decision === "accepted" || i.decision === "rejected"
  ).length;

  const handleApplyIssueDecisionsToDraft = () => {
    let nextText = content.original_content;
    for (const issue of issues) {
      if (issue.decision === "rejected") continue;
      if (
        issue.correction_decision === "accepted" ||
        issue.correction_decision === "edited"
      ) {
        const replacement = issue.final_corrected_text || issue.suggested_correction;
        if (issue.original_text && replacement && nextText.includes(issue.original_text)) {
          nextText = nextText.replace(issue.original_text, replacement);
        }
      }
    }
    setFinalDraft(nextText);
    setFeedback("Applied your accepted and manually edited issue corrections to the final draft preview.");
  };

  const handleSaveDraft = async () => {
    setSavingFinal(true);
    setError(null);
    setFeedback(null);
    try {
      await onSaveDraftCorrection(content.id, finalDraft, finalDraft);
      setIsEditingFinal(false);
      setFeedback("Final content draft saved. Click 'Approve Final Content' when ready to publish.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft.");
    } finally {
      setSavingFinal(false);
    }
  };

  const handleFinalApproval = async (status: ApprovalStatus, overrideText?: string) => {
    const nextFinal = overrideText ?? finalDraft;
    setSavingFinal(true);
    setError(null);
    setFeedback(null);
    try {
      await onApproveContent(content.id, {
        approval_status: status,
        corrected_content:
          status === "Approved Corrected" ? nextFinal : content.corrected_content,
        final_content: nextFinal,
      });
      setIsEditingFinal(false);
      setFeedback(`Content status updated to "${status}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save content approval.");
    } finally {
      setSavingFinal(false);
    }
  };

  const handleGenerateSuggestions = async () => {
    setGeneratingSuggestions(true);
    setError(null);
    setSuggestionNotice(null);
    try {
      const res = await api.generateGuidelineSuggestions(brand.id);
      setSuggestions(res.suggestions);
      if (res.message) {
        setSuggestionNotice(res.message);
      } else if (res.generated_count > 0) {
        setSuggestionNotice(
          `Generated ${res.generated_count} proposed guideline update${res.generated_count === 1 ? "" : "s"} from saved reviewer decisions. Permanent brand guidelines remain unchanged until approved.`
        );
      } else {
        setSuggestionNotice("No new guideline updates needed beyond existing suggestions.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate guideline suggestions.");
    } finally {
      setGeneratingSuggestions(false);
    }
  };

  const handleApproveSuggestion = async (id: number, editedProposed: string) => {
    setError(null);
    const res = await api.approveGuidelineSuggestion(id, editedProposed);
    setSuggestions((prev) => prev.map((s) => (s.id === id ? res.suggestion : s)));
    onBrandUpdated(res.brand);
    setSuggestionNotice(
      `Approved suggestion #${id}. "${brand.brand_name}" guidelines have been permanently updated.`
    );
  };

  const handleRejectSuggestion = async (id: number) => {
    setError(null);
    const res = await api.rejectGuidelineSuggestion(id);
    setSuggestions((prev) => prev.map((s) => (s.id === id ? res.suggestion : s)));
    setSuggestionNotice(
      `Rejected suggestion #${id}. Permanent brand guidelines were not modified.`
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Analysis Summary */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{brand?.brand_name ?? "Brand"}</span>
              <span aria-hidden="true">·</span>
              <span>{content.content_type}</span>
              {content.detected_language && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-[#141A2E]">
                    Language: {content.detected_language}
                  </span>
                </>
              )}
              {content.source_type && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Source: {content.source_type}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{content.created_at}</span>
            </div>
            <h2 className="text-xl font-semibold text-[#141A2E]">{content.title}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {historyItems.length > 1 && (
              <select
                aria-label="Switch analysed submission"
                value={content.id}
                onChange={(e) => onSelectAnalysis(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-[#D5D9E6] bg-white text-xs text-[#141A2E] focus:outline-none focus:border-[#4DA6FF] max-w-[220px]"
              >
                {historyItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.id} — {item.title}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => onNavigate("review")}
              className="px-3.5 py-2 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              Full Approval View
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-[#E5E7F0] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-[11px] text-slate-500 mb-0.5">Analysis Status</div>
              <AnalysisStatusLabel status={content.analysis_status} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-0.5">Content Approval</div>
              <ApprovalStatusLabel status={content.approval_status} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs text-slate-600 tabular-nums">
            <span>
              <strong className="font-semibold text-[#141A2E]">{issues.length}</strong> issues
              ({reviewedCount} reviewed)
            </span>
            <span className="text-rose-700">
              <strong className="font-semibold">{highCount}</strong> High
            </span>
            <span className="text-amber-700">
              <strong className="font-semibold">{mediumCount}</strong> Medium
            </span>
            <span className="text-slate-600">
              <strong className="font-semibold">{lowCount}</strong> Low
            </span>
          </div>
        </div>

        {fallback_reason && (
          <div className="bg-[#EEF6FF] border border-[#D2E6FF] rounded-lg px-3.5 py-2.5 text-xs text-[#141A2E]">
            <strong>Analysis Mode Note:</strong> {fallback_reason}
          </div>
        )}
      </section>

      {error && (
        <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {feedback && (
        <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{feedback}</span>
        </div>
      )}

      {/* 2 & 3. Individual Issue Cards with Accept/Reject & Correction Controls */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-[#141A2E]">
              Individual Issue Review ({issues.length})
            </h3>
            <p className="text-xs text-slate-500">
              Review each finding independently. Accepting an issue does not automatically accept its suggested correction.
            </p>
          </div>
        </div>

        {issues.length === 0 ? (
          <div className="bg-white border border-[#E5E7F0] rounded-xl p-8 text-center space-y-2">
            <ShieldCheck className="w-8 h-8 text-emerald-600 mx-auto" />
            <h4 className="text-sm font-semibold text-[#141A2E]">No guideline violations found</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              This content aligns with {brand?.brand_name}&apos;s guidelines. You can approve the final content directly below.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {issues.map((issue, idx) => (
              <IssueReviewCard
                key={issue.id}
                issue={issue}
                index={idx}
                onSaveReview={onReviewIssue}
              />
            ))}
          </div>
        )}
      </section>

      {/* 4 & 5. Correction Comparison & Final Approval Button */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7F0] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#141A2E]">
              Correction Comparison & Final Content Approval
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Compare the original content with the final version, edit if needed, and explicitly approve before publishing.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {issues.length > 0 && (
              <button
                type="button"
                onClick={handleApplyIssueDecisionsToDraft}
                className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] whitespace-nowrap"
              >
                Sync Issue Corrections
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsEditingFinal((prev) => !prev)}
              className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Edit3 className="w-3.5 h-3.5" />
              {isEditingFinal ? "Preview Diff" : "Edit Final Text"}
            </button>
            <button
              type="button"
              disabled={savingFinal}
              onClick={() => handleFinalApproval("Approved Original", content.original_content)}
              className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] whitespace-nowrap"
            >
              Approve Original
            </button>
            <button
              type="button"
              disabled={savingFinal}
              onClick={() => handleFinalApproval("Rejected")}
              className="px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-xs font-medium text-rose-800 whitespace-nowrap"
            >
              Reject Content
            </button>
            <button
              type="button"
              disabled={savingFinal}
              onClick={() => handleFinalApproval("Approved Corrected")}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {content.approval_status === "Approved Corrected"
                ? "Final Content Approved"
                : "Approve Final Content"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#E5E7F0]">
          <div className="p-6 space-y-2">
            <div className="text-xs font-semibold text-slate-500">Original Submitted Content</div>
            <div className="text-sm leading-relaxed text-[#141A2E] whitespace-pre-wrap pt-1">
              {diff.originalSegments.map((seg, idx) =>
                seg.type === "removed" ? (
                  <mark
                    key={idx}
                    className="bg-rose-100 text-rose-900 line-through decoration-rose-500 px-0.5 rounded-sm"
                  >
                    {seg.text}
                  </mark>
                ) : (
                  <span key={idx}>{seg.text}</span>
                )
              )}
            </div>
          </div>

          <div className="p-6 space-y-2 bg-[#F7F8FC]/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#6B5CE7]">
                {isEditingFinal ? "Edit Final Content" : "Final Content Version"}
              </span>
              <ApprovalStatusLabel status={content.approval_status} />
            </div>

            {isEditingFinal ? (
              <div className="space-y-3 pt-1">
                <textarea
                  rows={6}
                  value={finalDraft}
                  onChange={(e) => setFinalDraft(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-[#D5D9E6] bg-white text-sm leading-relaxed text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFinalDraft(content.corrected_content || content.original_content);
                      setIsEditingFinal(false);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-white text-xs font-medium text-slate-600"
                  >
                    Reset to AI Suggestion
                  </button>
                  <button
                    type="button"
                    disabled={savingFinal}
                    onClick={handleSaveDraft}
                    className="px-3.5 py-1.5 rounded-lg bg-[#6B5CE7] text-white text-xs font-medium"
                  >
                    Save Draft Changes
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm leading-relaxed text-[#141A2E] whitespace-pre-wrap pt-1">
                {diff.correctedSegments.map((seg, idx) =>
                  seg.type === "added" ? (
                    <mark
                      key={idx}
                      className="bg-emerald-100 text-emerald-900 px-0.5 rounded-sm font-medium"
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={idx}>{seg.text}</span>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 6. Guideline Improvement Suggestions */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Lightbulb className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-base font-semibold text-[#141A2E]">
                Guideline Improvement Suggestions
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Proposed updates generated from saved issue reviews for {brand?.brand_name}. Permanent brand guidelines only change after explicit human approval.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={generatingSuggestions}
            onClick={handleGenerateSuggestions}
            className="px-4 py-2 rounded-lg bg-[#6B5CE7] hover:bg-[#5A4BD6] disabled:opacity-60 text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
          >
            {generatingSuggestions
              ? "Analysing Review Feedback..."
              : "Suggest Guideline Updates"}
          </button>
        </div>

        {suggestionNotice && (
          <div
            role="status"
            className="bg-[#EEF6FF] border border-[#D2E6FF] text-[#141A2E] rounded-lg px-3.5 py-2.5 text-xs"
          >
            {suggestionNotice}
          </div>
        )}

        {loadingSuggestions ? (
          <div className="h-20 bg-slate-50 rounded-lg animate-pulse" />
        ) : suggestions.length === 0 ? (
          <div className="border border-dashed border-[#D5D9E6] rounded-xl p-6 text-center text-xs text-slate-500">
            No guideline suggestions yet for {brand?.brand_name}. Accept or reject issues above, then click &ldquo;Suggest Guideline Updates&rdquo; to generate candidate improvements.
          </div>
        ) : (
          <div className="space-y-4">
            {suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onApprove={handleApproveSuggestion}
                onReject={handleRejectSuggestion}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
