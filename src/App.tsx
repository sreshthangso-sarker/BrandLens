import { useCallback, useEffect, useState } from "react";
import type {
  AnalysisDetailResponse,
  ApprovalStatus,
  Brand,
  BrandInput,
  DashboardStats,
  HealthResponse,
  HistoryItem,
  PageView,
} from "./types.ts";
import { api } from "./services/api.ts";
import { Layout } from "./components/Layout.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { GuidelinesPage } from "./pages/GuidelinesPage.tsx";
import { CheckerPage } from "./pages/CheckerPage.tsx";
import { ResultsPage } from "./pages/ResultsPage.tsx";
import { ReviewPage } from "./pages/ReviewPage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";

const EMPTY_STATS: DashboardStats = {
  total_analyzed: 0,
  compliant_count: 0,
  needs_review_count: 0,
  non_compliant_count: 0,
  pending_approval_count: 0,
  approved_count: 0,
  rejected_count: 0,
};

export default function App() {
  const [activePage, setActivePage] = useState<PageView>("dashboard");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [activeDetail, setActiveDetail] = useState<AnalysisDetailResponse | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const res = await api.getHistory();
    setHistoryItems(res.items);
    setStats(res.stats ?? EMPTY_STATS);
    return res.items;
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoadingInitial(true);
    setGlobalError(null);
    try {
      const [healthRes, brandsRes, historyRes] = await Promise.all([
        api.getHealth(),
        api.getBrands(),
        api.getHistory(),
      ]);
      setHealth(healthRes);
      setBrands(brandsRes.brands);
      if (brandsRes.brands.length > 0) {
        setSelectedBrandId((prev) => prev ?? brandsRes.brands[0].id);
      }
      setHistoryItems(historyRes.items);
      setStats(historyRes.stats ?? EMPTY_STATS);

      if (historyRes.items.length > 0) {
        const latestDetail = await api.getAnalysisDetail(historyRes.items[0].id);
        setActiveDetail(latestDetail);
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error
          ? err.message
          : "Unable to connect to the BrandLens backend."
      );
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const handleOpenAnalysis = async (id: number, targetPage: PageView = "results") => {
    setLoadingDetail(true);
    setGlobalError(null);
    try {
      const detail = await api.getAnalysisDetail(id);
      setActiveDetail(detail);
      setActivePage(targetPage);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Failed to load analysis details."
      );
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleUpdateBrand = async (id: number, payload: BrandInput) => {
    const { brand } = await api.updateBrand(id, payload);
    setBrands((prev) => prev.map((b) => (b.id === id ? brand : b)));
  };

  const handleCreateBrand = async (payload: BrandInput) => {
    const { brand } = await api.createBrand(payload);
    setBrands((prev) => [...prev, brand]);
    setSelectedBrandId(brand.id);
  };

  const handleAnalyzeContent = async (payload: {
    brand_id: number;
    title: string;
    content_type: string;
    source_type?: string;
    detected_language?: string;
    content: string;
    force_demo: boolean;
  }) => {
    const result = await api.analyzeContent(payload);
    setActiveDetail(result);
    await loadHistory();
    setActivePage("results");
  };

  const handleSaveDraftCorrection = async (
    id: number,
    correctedContent: string,
    finalContent: string
  ) => {
    const { content } = await api.saveReview(id, {
      corrected_content: correctedContent,
      final_content: finalContent,
    });
    setActiveDetail((prev) => (prev ? { ...prev, content } : prev));
    await loadHistory();
  };

  const handleReviewIssue = async (
    issueDbId: number,
    payload: {
      decision?: "pending" | "accepted" | "rejected";
      reviewer_reason?: string;
      correction_decision?: "pending" | "accepted" | "rejected" | "edited";
      final_corrected_text?: string;
    }
  ) => {
    const { issues } = await api.reviewIssue(issueDbId, payload);
    setActiveDetail((prev) => (prev ? { ...prev, issues } : prev));
  };

  const handleApproveContent = async (
    contentId: number,
    payload: {
      approval_status: ApprovalStatus;
      corrected_content: string;
      final_content: string;
      review_notes?: string;
    }
  ) => {
    const { content } = await api.approveContent(contentId, payload);
    setActiveDetail((prev) => (prev ? { ...prev, content } : prev));
    await loadHistory();
  };

  const handleBrandUpdatedFromSuggestion = (updatedBrand: Brand) => {
    setBrands((prev) =>
      prev.map((b) => (b.id === updatedBrand.id ? updatedBrand : b))
    );
    setActiveDetail((prev) =>
      prev && prev.brand.id === updatedBrand.id
        ? { ...prev, brand: updatedBrand }
        : prev
    );
  };

  const handleSubmitReview = async (
    id: number,
    payload: {
      approval_status: ApprovalStatus;
      corrected_content: string;
      final_content: string;
      review_notes: string;
    }
  ) => {
    const { content } = await api.approveContent(id, payload);
    setActiveDetail((prev) => (prev ? { ...prev, content } : prev));
    await loadHistory();
  };

  const handleResetHistory = async () => {
    const res = await api.resetHistory();
    setHistoryItems([]);
    setStats(res.stats ?? EMPTY_STATS);
    setActiveDetail(null);
  };

  const selectedBrand = brands.find((b) => b.id === selectedBrandId) ?? brands[0];

  return (
    <Layout
      activePage={activePage}
      onNavigate={setActivePage}
      brands={brands}
      selectedBrandId={selectedBrandId}
      onSelectBrand={setSelectedBrandId}
      health={health}
      historyCount={historyItems.length}
      onResetHistory={handleResetHistory}
    >
      {globalError && (
        <div
          role="alert"
          className="mb-6 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-4"
        >
          <span>{globalError}</span>
          <button
            type="button"
            onClick={loadInitialData}
            className="text-xs font-semibold underline shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {activePage === "dashboard" && (
        <DashboardPage
          stats={stats}
          recentItems={historyItems}
          selectedBrand={selectedBrand}
          loading={loadingInitial}
          onNavigate={setActivePage}
          onOpenAnalysis={handleOpenAnalysis}
        />
      )}

      {activePage === "guidelines" && (
        <GuidelinesPage
          brands={brands}
          selectedBrandId={selectedBrandId}
          onSelectBrand={setSelectedBrandId}
          onUpdateBrand={handleUpdateBrand}
          onCreateBrand={handleCreateBrand}
        />
      )}

      {activePage === "checker" && (
        <CheckerPage
          brands={brands}
          selectedBrandId={selectedBrandId}
          onSelectBrand={setSelectedBrandId}
          health={health}
          onAnalyze={handleAnalyzeContent}
        />
      )}

      {activePage === "results" && (
        <ResultsPage
          detail={activeDetail}
          historyItems={historyItems}
          loading={loadingDetail}
          onSelectAnalysis={(id) => handleOpenAnalysis(id, "results")}
          onSaveDraftCorrection={handleSaveDraftCorrection}
          onReviewIssue={handleReviewIssue}
          onApproveContent={handleApproveContent}
          onBrandUpdated={handleBrandUpdatedFromSuggestion}
          onNavigate={setActivePage}
        />
      )}

      {activePage === "review" && (
        <ReviewPage
          detail={activeDetail}
          historyItems={historyItems}
          loading={loadingDetail}
          onSelectAnalysis={(id) => handleOpenAnalysis(id, "review")}
          onSubmitReview={handleSubmitReview}
          onNavigate={setActivePage}
        />
      )}

      {activePage === "history" && (
        <HistoryPage
          items={historyItems}
          loading={loadingInitial}
          onOpenAnalysis={handleOpenAnalysis}
          onResetHistory={handleResetHistory}
          onNavigate={setActivePage}
        />
      )}
    </Layout>
  );
}
