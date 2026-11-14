import { useEffect, useState } from "react";
import { Check, CheckCircle2, Save, ShieldAlert, XCircle } from "lucide-react";
import type {
  AnalysisDetailResponse,
  ApprovalStatus,
  HistoryItem,
  PageView,
} from "../types.ts";
import {
  AnalysisStatusLabel,
  ApprovalStatusLabel,
} from "../components/StatusIndicator.tsx";

interface ReviewPageProps {
  detail: AnalysisDetailResponse | null;
  historyItems: HistoryItem[];
  loading: boolean;
  onSelectAnalysis: (id: number) => void;
  onSubmitReview: (
    id: number,
    payload: {
      approval_status: ApprovalStatus;
      corrected_content: string;
      final_content: string;
      review_notes: string;
    }
  ) => Promise<void>;
  onNavigate: (page: PageView) => void;
}

export function ReviewPage({
  detail,
  historyItems,
  loading,
  onSelectAnalysis,
  onSubmitReview,
  onNavigate,
}: ReviewPageProps) {
  const [finalDraft, setFinalDraft] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [selectedDecision, setSelectedDecision] = useState<ApprovalStatus>("Approved Corrected");
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (detail) {
      const c = detail.content;
      const initialText = c.final_content || c.corrected_content || c.original_content;
      setFinalDraft(initialText);
      setReviewNotes(c.review_notes || "");
      setSelectedDecision(
        c.approval_status === "Pending Review" ? "Approved Corrected" : c.approval_status
      );
      setSavedBanner(null);
      setError(null);
    }
  }, [detail]);

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
        <h2 className="text-base font-semibold text-[#141A2E]">No submission selected for review</h2>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Run a content check first or pick an analysed item from History to complete human review and approval.
        </p>
        <div className="pt-2 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate("checker")}
            className="px-4 py-2 rounded-lg bg-[#6B5CE7] text-white text-xs font-medium"
          >
            Open Content Checker
          </button>
          {historyItems.length > 0 && (
            <button
              type="button"
              onClick={() => onSelectAnalysis(historyItems[0].id)}
              className="px-4 py-2 rounded-lg border border-[#D5D9E6] text-xs font-medium text-[#141A2E]"
            >
              Load Latest Submission
            </button>
          )}
        </div>
      </div>
    );
  }

  const { content, brand } = detail;

  const handleDecision = async (decision: ApprovalStatus, overrideText?: string) => {
    const nextFinal = overrideText !== undefined ? overrideText : finalDraft;
    setSelectedDecision(decision);
    if (overrideText !== undefined) {
      setFinalDraft(overrideText);
    }

    setSaving(true);
    setError(null);
    setSavedBanner(null);
    try {
      await onSubmitReview(content.id, {
        approval_status: decision,
        corrected_content:
          decision === "Approved Corrected" ? nextFinal : content.corrected_content,
        final_content: nextFinal,
        review_notes: reviewNotes,
      });
      setSavedBanner(`Saved review decision "${decision}" and final content to SQLite.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save review decision.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Governance Header */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{brand?.brand_name ?? "Brand"}</span>
              <span aria-hidden="true">·</span>
              <span>{content.content_type}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{content.created_at}</span>
            </div>
            <h2 className="text-xl font-semibold text-[#141A2E] mt-1">{content.title}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {historyItems.length > 1 && (
              <select
                aria-label="Select submission to review"
                value={content.id}
                onChange={(e) => onSelectAnalysis(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-[#D5D9E6] bg-white text-xs text-[#141A2E] focus:outline-none focus:border-[#4DA6FF] max-w-[240px]"
              >
                {historyItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.id} — {item.title} ({item.approval_status})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => onNavigate("results")}
              className="px-3.5 py-2 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] whitespace-nowrap"
            >
              Back to Analysis Results
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-[#E5E7F0] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-[11px] text-slate-500 mb-0.5">AI Analysis Status</div>
              <AnalysisStatusLabel status={content.analysis_status} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-0.5">Current Human Decision</div>
              <ApprovalStatusLabel status={content.approval_status} />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Human-in-the-loop required: AI never automatically approves or publishes content.
          </p>
        </div>
      </section>

      {error && (
        <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {savedBanner && (
        <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{savedBanner}</span>
        </div>
      )}

      {/* Side-by-Side Reference & Final Editable Draft */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="bg-white border border-[#E5E7F0] rounded-xl p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[#141A2E]">Original Submission</h3>
            <p className="text-xs text-slate-500 mt-0.5">Submitted content before AI revisions</p>
          </div>
          <div className="p-4 rounded-lg bg-[#F7F8FC] border border-[#E5E7F0] text-sm leading-relaxed text-[#141A2E] whitespace-pre-wrap">
            {content.original_content}
          </div>

          <div className="pt-2">
            <h4 className="text-xs font-semibold text-[#6B5CE7] mb-1.5">
              AI Suggested Correction
            </h4>
            <div className="p-4 rounded-lg bg-[#F7F8FC] border border-[#E5E7F0] text-sm leading-relaxed text-[#141A2E] whitespace-pre-wrap">
              {content.corrected_content}
            </div>
          </div>
        </section>

        <section className="bg-white border border-[#E5E7F0] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#141A2E]">Final Version for Publication</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose Original, Corrected, or edit the final copy directly below.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setFinalDraft(content.original_content)}
                className="text-xs font-medium text-slate-600 hover:text-[#141A2E] underline"
              >
                Load Original
              </button>
              <button
                type="button"
                onClick={() => setFinalDraft(content.corrected_content)}
                className="text-xs font-medium text-[#6B5CE7] hover:text-[#5A4BD6] underline"
              >
                Load Corrected
              </button>
            </div>
          </div>

          <textarea
            aria-label="Final approved content"
            rows={7}
            value={finalDraft}
            onChange={(e) => setFinalDraft(e.target.value)}
            className="w-full px-3.5 py-3 rounded-lg border border-[#D5D9E6] text-sm leading-relaxed text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
          />

          <div>
            <label
              htmlFor="reviewer-notes"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              Reviewer Notes (Optional)
            </label>
            <input
              id="reviewer-notes"
              type="text"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="e.g., Approved after removing prohibited superlative."
              className="w-full px-3.5 py-2 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            />
          </div>

          {/* Human Review Decision Actions */}
          <div className="pt-3 border-t border-[#E5E7F0] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={saving}
                onClick={() => handleDecision("Approved Original", content.original_content)}
                className="px-3 py-2.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Approve Original
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => handleDecision("Approved Corrected")}
                className="px-3 py-2.5 rounded-lg bg-[#3DD9C4] hover:bg-[#31C4B0] text-[#141A2E] text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Approve Corrected
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => handleDecision("Rejected")}
                className="px-3 py-2.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject Content
              </button>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => handleDecision(selectedDecision)}
              className="w-full px-4 py-2.5 rounded-lg bg-[#141A2E] hover:bg-[#1E2642] disabled:opacity-60 text-white text-xs font-medium inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving Decision..." : "Save Final Approved Version"}
            </button>

            {content.analysis_status === "Non-Compliant" && (
              <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  This submission was flagged as Non-Compliant. Approving the corrected version is recommended unless a policy exception applies.
                </span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
