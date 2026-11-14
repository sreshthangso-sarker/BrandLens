import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { AnalysisStatus, HistoryItem, PageView } from "../types.ts";
import {
  AnalysisStatusLabel,
  ApprovalStatusLabel,
} from "../components/StatusIndicator.tsx";

interface HistoryPageProps {
  items: HistoryItem[];
  loading: boolean;
  onOpenAnalysis: (id: number, targetPage: PageView) => void;
  onNavigate: (page: PageView) => void;
}

type StatusFilter = "All" | AnalysisStatus;

export function HistoryPage({
  items,
  loading,
  onOpenAnalysis,
  onNavigate,
}: HistoryPageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesStatus =
        statusFilter === "All" || item.analysis_status === statusFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.brand_name.toLowerCase().includes(q) ||
        item.content_type.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [items, searchQuery, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Search and Filter Controls */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Search analysis history"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, brand, or content type..."
            className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F7F8FC] border border-[#E5E7F0] rounded-lg">
          {(["All", "Compliant", "Needs Review", "Non-Compliant"] as StatusFilter[]).map(
            (tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  statusFilter === tab
                    ? "bg-white text-[#141A2E] shadow-xs"
                    : "text-slate-600 hover:text-[#141A2E]"
                }`}
              >
                {tab}
              </button>
            )
          )}
        </div>
      </section>

      {/* History Table */}
      <section className="bg-white border border-[#E5E7F0] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((row) => (
              <div key={row} className="h-11 bg-slate-100 rounded-md animate-pulse" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <h3 className="text-sm font-semibold text-[#141A2E]">
              {items.length === 0 ? "No analysis history yet" : "No matching submissions"}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {items.length === 0
                ? "Once you analyse content in the Content Checker, every report and human approval status is saved here."
                : "Try clearing your search term or switching the status filter."}
            </p>
            {items.length === 0 && (
              <button
                type="button"
                onClick={() => onNavigate("checker")}
                className="mt-2 px-4 py-2 rounded-lg bg-[#6B5CE7] text-white text-xs font-medium"
              >
                Analyse First Content
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7F0] bg-[#F7F8FC] text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-6">Content Title</th>
                  <th className="py-2.5 px-4">Brand</th>
                  <th className="py-2.5 px-4">Submission Date</th>
                  <th className="py-2.5 px-4">Analysis Status</th>
                  <th className="py-2.5 px-4">Approval Status</th>
                  <th className="py-2.5 px-4 text-right">Issues</th>
                  <th className="py-2.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7F0] text-sm">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-[#F7F8FC]/70 transition-colors">
                    <td className="py-3 px-6">
                      <div className="font-medium text-[#141A2E] max-w-[260px] truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-slate-500">{item.content_type}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {item.brand_name}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {item.created_at}
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
                        View Results
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
