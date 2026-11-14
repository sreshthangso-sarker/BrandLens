import { ArrowRight, BookOpen, CheckSquare, ScanSearch } from "lucide-react";
import type { Brand, DashboardStats, HistoryItem, PageView } from "../types.ts";
import { AnalysisStatusLabel, ApprovalStatusLabel } from "../components/StatusIndicator.tsx";

interface DashboardPageProps {
  stats: DashboardStats;
  recentItems: HistoryItem[];
  selectedBrand: Brand | undefined;
  loading: boolean;
  onNavigate: (page: PageView) => void;
  onOpenAnalysis: (id: number, targetPage?: PageView) => void;
}

export function DashboardPage({
  stats,
  recentItems,
  selectedBrand,
  loading,
  onNavigate,
  onOpenAnalysis,
}: DashboardPageProps) {
  const total = Number(stats.total_analyzed || 0);
  const compliant = Number(stats.compliant_count || 0);
  const flagged = Number(stats.needs_review_count || 0) + Number(stats.non_compliant_count || 0);
  const awaitingApproval = Number(stats.pending_approval_count || 0);

  return (
    <div className="space-y-6">
      {/* Intro & Primary Action */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="text-xl sm:text-2xl font-semibold text-[#141A2E] tracking-tight">
            Check marketing content before you publish
          </h2>
          <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
            Verify drafts against saved brand voice, prohibited terminology, and approved factual claims. Review every suggested change with human sign-off before publication.
          </p>
          {selectedBrand && (
            <div className="mt-3 text-xs text-slate-500 flex flex-wrap items-center gap-2">
              <span>Selected brand: <strong className="text-[#141A2E]">{selectedBrand.brand_name}</strong></span>
              <span aria-hidden="true">·</span>
              <span>Tone: {selectedBrand.tone || "Not specified"}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate("guidelines")}
            className="px-4 py-2.5 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-[#141A2E] text-sm font-medium transition-colors whitespace-nowrap"
          >
            Edit Brand Guidelines
          </button>
          <button
            type="button"
            onClick={() => onNavigate("checker")}
            className="px-4 py-2.5 rounded-lg bg-[#6B5CE7] hover:bg-[#5A4BD6] text-white text-sm font-medium transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            Analyse New Content
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Real Database Metrics Strip */}
      <section aria-label="Governance summary statistics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-white border border-[#E5E7F0] rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-[#E5E7F0]">
          <div className="p-5">
            <div className="text-xs font-medium text-slate-500">Total Content Analysed</div>
            <div className="mt-2 text-2xl font-semibold text-[#141A2E] tabular-nums">
              {loading ? "—" : total}
            </div>
            <div className="mt-1 text-xs text-slate-500">Stored in SQLite history</div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-500">Compliant Content</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-700 tabular-nums">
              {loading ? "—" : compliant}
            </div>
            <div className="mt-1 text-xs text-slate-500">Zero guideline issues detected</div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-500">Flagged for Review</div>
            <div className="mt-2 text-2xl font-semibold text-amber-700 tabular-nums">
              {loading ? "—" : flagged}
            </div>
            <div className="mt-1 text-xs text-slate-500">Needs review or non-compliant</div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-500">Awaiting Human Approval</div>
            <div className="mt-2 text-2xl font-semibold text-[#6B5CE7] tabular-nums">
              {loading ? "—" : awaitingApproval}
            </div>
            <div className="mt-1 text-xs text-slate-500">Requires editorial sign-off</div>
          </div>
        </div>
      </section>

      {/* 3-Step Governance Workflow Overview */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => onNavigate("guidelines")}
          className="text-left bg-white border border-[#E5E7F0] hover:border-[#4DA6FF] rounded-xl p-5 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#4DA6FF]">Step 01</span>
            <BookOpen className="w-4 h-4 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-[#141A2E] mt-2">Configure Brand Guidelines</h3>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Define preferred tone, prohibited phrases, and verified brand facts for NovaWear or custom brands.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate("checker")}
          className="text-left bg-white border border-[#E5E7F0] hover:border-[#6B5CE7] rounded-xl p-5 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6B5CE7]">Step 02</span>
            <ScanSearch className="w-4 h-4 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-[#141A2E] mt-2">Submit & Analyse Content</h3>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Check social posts, ads, or product copy with explainable rule references and suggested rewrites.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate("review")}
          className="text-left bg-white border border-[#E5E7F0] hover:border-[#3DD9C4] rounded-xl p-5 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-teal-700">Step 03</span>
            <CheckSquare className="w-4 h-4 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-[#141A2E] mt-2">Human Review & Approval</h3>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Compare original and corrected drafts, edit manually if needed, and record final human approval.
          </p>
        </button>
      </section>

      {/* Recent Analyses Table */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7F0] flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[#141A2E]">Recent Submissions</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Latest analysed drafts persisted in the BrandLens database
            </p>
          </div>
          {recentItems.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate("history")}
              className="text-xs font-medium text-[#6B5CE7] hover:text-[#5A4BD6] whitespace-nowrap"
            >
              View All History
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-10 bg-slate-100 rounded-md animate-pulse" />
            ))}
          </div>
        ) : recentItems.length === 0 ? (
          <div className="p-10 text-center">
            <h4 className="text-sm font-semibold text-[#141A2E]">No content analysed yet</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Start by testing the preloaded NovaWear sample marketing copy in the Content Checker to inspect how BrandLens detects guideline violations.
            </p>
            <button
              type="button"
              onClick={() => onNavigate("checker")}
              className="mt-4 px-4 py-2 rounded-lg bg-[#6B5CE7] hover:bg-[#5A4BD6] text-white text-xs font-medium transition-colors"
            >
              Open Content Checker
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7F0] bg-[#F7F8FC] text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-6">Title</th>
                  <th className="py-2.5 px-4">Brand</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Analysis Status</th>
                  <th className="py-2.5 px-4">Approval Status</th>
                  <th className="py-2.5 px-4 text-right">Issues</th>
                  <th className="py-2.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7F0] text-sm">
                {recentItems.slice(0, 5).map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-[#F7F8FC]/70 transition-colors"
                  >
                    <td className="py-3 px-6 font-medium text-[#141A2E] max-w-[240px] truncate">
                      {item.title}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                      {item.brand_name}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                      {item.content_type}
                    </td>
                    <td className="py-3 px-4">
                      <AnalysisStatusLabel status={item.analysis_status} />
                    </td>
                    <td className="py-3 px-4">
                      <ApprovalStatusLabel status={item.approval_status} />
                    </td>
                    <td className="py-3 px-4 text-right text-xs font-mono tabular-nums text-slate-700">
                      {item.issue_count}
                    </td>
                    <td className="py-3 px-6 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenAnalysis(item.id, "results")}
                        className="text-xs font-medium text-[#4DA6FF] hover:text-[#2E89E8] mr-3"
                      >
                        Results
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenAnalysis(item.id, "review")}
                        className="text-xs font-medium text-[#6B5CE7] hover:text-[#5A4BD6]"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
