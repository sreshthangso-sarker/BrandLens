import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Edit3, RotateCcw, ShieldCheck } from "lucide-react";
import type {
  AnalysisDetailResponse,
  HistoryItem,
  PageView,
} from "../types.ts";
import { computeWordDiff } from "../utils/diff.ts";
import {
  AnalysisStatusLabel,
  ApprovalStatusLabel,
  SeverityLabel,
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
  onNavigate: (page: PageView) => void;
}

export function ResultsPage({
  detail,
  historyItems,
  loading,
  onSelectAnalysis,
  onSaveDraftCorrection,
  onNavigate,
}: ResultsPageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedCorrection, setEditedCorrection] = useState("");
  const [choiceState, setChoiceState] = useState<"suggested" | "accepted" | "rejected">("suggested");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (detail) {
      setEditedCorrection(detail.content.corrected_content || detail.content.original_content);
      setIsEditing(false);
      setFeedback(null);
      setError(null);
      if (detail.content.final_content === detail.content.original_content && detail.content.corrected_content !== detail.content.original_content) {
        setChoiceState("rejected");
      } else {
        setChoiceState("suggested");
      }
    }
  }, [detail]);

  const diff = useMemo(() => {
    if (!detail) return { originalSegments: [], correctedSegments: [] };
    return computeWordDiff(detail.content.original_content, editedCorrection);
  }, [detail, editedCorrection]);

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
          Submit content in the Content Checker or select a previous analysis from History to inspect detailed guideline findings.
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

  const handleAcceptCorrection = async () => {
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await onSaveDraftCorrection(content.id, editedCorrection, editedCorrection);
      setChoiceState("accepted");
      setIsEditing(false);
      setFeedback("Suggested correction accepted and saved to draft. Proceed to Review & Approval for final sign-off.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save accepted correction.");
    } finally {
      setSaving(false);
    }
  };

  const handleRejectCorrection = async () => {
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await onSaveDraftCorrection(content.id, editedCorrection, content.original_content);
      setChoiceState("rejected");
      setIsEditing(false);
      setFeedback("Suggested correction rejected. The original content remains selected for review.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save choice.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Analysis Summary Header */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{brand?.brand_name ?? "Brand"}</span>
              <span aria-hidden="true">·</span>
              <span>{content.content_type}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{content.created_at}</span>
              <span aria-hidden="true">·</span>
              <span>
                {content.analysis_mode === "gemini"
                  ? "Analysed with Google Gemini"
                  : "Demo Mode (Sample Rule Analysis)"}
              </span>
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
              className="px-4 py-2 rounded-lg bg-[#6B5CE7] hover:bg-[#5A4BD6] text-white text-xs sm:text-sm font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              Proceed to Review & Approval
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status & Issue Count Breakdown */}
        <div className="pt-4 border-t border-[#E5E7F0] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-[11px] text-slate-500 mb-0.5">Overall Analysis Status</div>
              <AnalysisStatusLabel status={content.analysis_status} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-0.5">Human Review Status</div>
              <ApprovalStatusLabel status={content.approval_status} />
            </div>
          </div>

          <div className="flex items-center gap-5 text-xs text-slate-600 tabular-nums">
            <span>
              <strong className="font-semibold text-[#141A2E]">{issues.length}</strong> total issues
            </span>
            <span className="text-rose-700">
              <strong className="font-semibold">{highCount}</strong> High
            </span>
            <span className="text-amber-700">
              <strong className="font-semibold">{mediumCount}</strong> Medium
            </span>
            <span className="text-[#6B5CE7]">
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

      {/* Side-by-Side Original vs Corrected Content Comparison */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7F0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#141A2E]">
              Original vs. Suggested Correction
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Changes are highlighted inline. Accept, reject, or manually edit the correction before human approval.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
              className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Edit3 className="w-3.5 h-3.5" />
              {isEditing ? "Preview Diff" : "Edit Manually"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleRejectCorrection}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                choiceState === "rejected"
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
              onClick={handleAcceptCorrection}
              className="px-3.5 py-1.5 rounded-lg bg-[#3DD9C4] hover:bg-[#31C4B0] text-[#141A2E] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              {choiceState === "accepted" ? "Correction Accepted" : "Accept Correction"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#E5E7F0]">
          {/* Original Pane */}
          <div className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Original Submitted Content
              </span>
              {choiceState === "rejected" && (
                <span className="text-xs font-medium text-rose-700">Selected for review</span>
              )}
            </div>
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

          {/* Corrected Pane */}
          <div className="p-6 space-y-2 bg-[#F7F8FC]/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#6B5CE7]">
                {isEditing ? "Manual Edit Mode" : "Suggested Corrected Version"}
              </span>
              {choiceState === "accepted" && (
                <span className="text-xs font-medium text-emerald-700">Accepted for review</span>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-3 pt-1">
                <textarea
                  rows={6}
                  value={editedCorrection}
                  onChange={(e) => setEditedCorrection(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-[#D5D9E6] bg-white text-sm leading-relaxed text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditedCorrection(content.corrected_content);
                      setIsEditing(false);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-white text-xs font-medium text-slate-600"
                  >
                    Reset to AI Suggestion
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleAcceptCorrection}
                    className="px-3.5 py-1.5 rounded-lg bg-[#6B5CE7] text-white text-xs font-medium"
                  >
                    Save Manual Edit
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

      {/* Explainable Issues Breakdown */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7F0]">
          <h3 className="text-base font-semibold text-[#141A2E]">
            Explainable Guideline Findings
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Every flagged item references an explicit guideline from {brand?.brand_name ?? "the selected brand"}.
          </p>
        </div>

        {issues.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <ShieldCheck className="w-8 h-8 text-emerald-600 mx-auto" />
            <h4 className="text-sm font-semibold text-[#141A2E]">No guideline violations found</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              This content aligns with {brand?.brand_name}&apos;s tone, preferred terminology, prohibited words list, and approved facts. You can proceed to human approval.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E5E7F0]">
            {issues.map((issue, idx) => (
              <div key={issue.id || idx} className="p-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-slate-400 tabular-nums">
                      {String(idx + 1).padStart(2, "0")}.
                    </span>
                    <span className="font-semibold text-sm text-[#141A2E]">
                      {issue.issue_type}
                    </span>
                    {issue.rule_reference && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-slate-500">{issue.rule_reference}</span>
                      </>
                    )}
                  </div>
                  <SeverityLabel severity={issue.severity} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                  <div className="bg-[#F7F8FC] rounded-lg p-3.5 space-y-1.5">
                    <div className="font-semibold text-slate-500">Flagged Excerpt</div>
                    <div className="text-sm text-rose-800 font-medium">
                      &ldquo;{issue.original_text}&rdquo;
                    </div>
                  </div>
                  <div className="bg-[#F7F8FC] rounded-lg p-3.5 space-y-1.5">
                    <div className="font-semibold text-slate-500">Relevant Brand Guideline</div>
                    <div className="text-sm text-[#141A2E]">{issue.brand_rule}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs pt-1">
                  <div>
                    <span className="font-semibold text-[#141A2E]">Why it was flagged: </span>
                    <span className="text-slate-600 leading-relaxed">{issue.explanation}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-emerald-700">Suggested correction: </span>
                    <span className="text-slate-700 leading-relaxed">{issue.suggested_correction}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
