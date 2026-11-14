import { useState } from "react";
import type { ReactNode } from "react";
import {
  BookOpen,
  CheckSquare,
  FileSearch,
  History,
  LayoutDashboard,
  Menu,
  ScanSearch,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { Brand, HealthResponse, PageView } from "../types.ts";

interface LayoutProps {
  activePage: PageView;
  onNavigate: (page: PageView) => void;
  brands: Brand[];
  selectedBrandId: number | null;
  onSelectBrand: (id: number) => void;
  health: HealthResponse | null;
  historyCount: number;
  onResetHistory: () => Promise<void>;
  children: ReactNode;
}

const NAV_ITEMS: Array<{
  id: PageView;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "guidelines", label: "Brand Guidelines", icon: BookOpen },
  { id: "checker", label: "Content Checker", icon: ScanSearch },
  { id: "results", label: "Analysis Results", icon: FileSearch },
  { id: "review", label: "Review & Approval", icon: CheckSquare },
  { id: "history", label: "Analysis History", icon: History },
];

const PAGE_TITLES: Record<PageView, string> = {
  dashboard: "Governance Overview",
  guidelines: "Brand Guidelines",
  checker: "Content Checker",
  results: "Analysis Results",
  review: "Review & Approval",
  history: "Analysis History",
};

export function Layout({
  activePage,
  onNavigate,
  brands,
  selectedBrandId,
  onSelectBrand,
  health,
  historyCount,
  onResetHistory,
  children,
}: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirmingSidebarReset, setConfirmingSidebarReset] = useState(false);
  const [resettingSidebar, setResettingSidebar] = useState(false);

  const selectedBrand = brands.find((b) => b.id === selectedBrandId) ?? brands[0];

  const handleSidebarReset = async () => {
    setResettingSidebar(true);
    try {
      await onResetHistory();
      setConfirmingSidebarReset(false);
    } finally {
      setResettingSidebar(false);
    }
  };

  const handleNavClick = (page: PageView) => {
    onNavigate(page);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-[#F7F8FC] text-[#141A2E]">
      {/* Mobile Sidebar Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-[#141A2E]/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar Navigation (240px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[240px] bg-[#141A2E] text-white flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div>
          {/* Brand Logo Area */}
          <div className="flex items-center justify-between px-5 h-16 border-b border-white/10">
            <button
              type="button"
              onClick={() => handleNavClick("dashboard")}
              className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-[#4DA6FF] rounded-md"
            >
              <div className="w-8 h-8 rounded-lg bg-[#6B5CE7] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-base font-semibold tracking-tight text-white leading-none">
                  BrandLens
                </div>
                <div className="text-[11px] text-slate-300 mt-1 leading-none">
                  Check Before You Publish
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="lg:hidden p-1.5 text-slate-300 hover:text-white rounded-md"
              aria-label="Close navigation menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Navigation */}
          <nav className="p-3 space-y-1" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#4DA6FF] ${
                    isActive
                      ? "bg-white/12 text-white"
                      : "text-slate-300 hover:text-white hover:bg-white/6"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? "text-[#3DD9C4]" : "text-slate-400"
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Active Brand Quick Switcher & AI Engine Mode Footer */}
        <div className="p-4 border-t border-white/10 space-y-3">
          {brands.length > 0 && (
            <div>
              <label
                htmlFor="sidebar-brand-select"
                className="block text-[11px] font-medium text-slate-300 mb-1.5"
              >
                Active Brand Profile
              </label>
              <select
                id="sidebar-brand-select"
                value={selectedBrand?.id ?? ""}
                onChange={(e) => onSelectBrand(Number(e.target.value))}
                className="w-full bg-white/8 border border-white/15 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#4DA6FF]"
              >
                {brands.map((brand) => (
                  <option
                    key={brand.id}
                    value={brand.id}
                    className="bg-[#141A2E] text-white"
                  >
                    {brand.brand_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="pt-1 space-y-2">
            {confirmingSidebarReset ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={resettingSidebar}
                  onClick={handleSidebarReset}
                  className="flex-1 px-2.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap"
                >
                  {resettingSidebar ? "Clearing..." : "Confirm Reset"}
                </button>
                <button
                  type="button"
                  disabled={resettingSidebar}
                  onClick={() => setConfirmingSidebarReset(false)}
                  className="px-2.5 py-2 rounded-lg border border-white/15 bg-white/6 hover:bg-white/12 text-xs text-slate-200 whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={historyCount === 0}
                onClick={() => setConfirmingSidebarReset(true)}
                title={
                  historyCount === 0
                    ? "Analysis history is already empty"
                    : "Clear all saved analysis history"
                }
                className="w-full px-3 py-2 rounded-lg border border-white/15 bg-white/6 hover:bg-rose-500/20 hover:border-rose-400/40 disabled:opacity-45 disabled:hover:bg-white/6 disabled:hover:border-white/15 disabled:cursor-not-allowed text-xs font-medium text-slate-200 hover:text-white inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                Reset Analysis History
              </button>
            )}

            <div className="text-[11px] text-slate-300 leading-relaxed">
              {health?.ai_mode === "gemini" ? (
                <span>Engine: Google Gemini ({health.model})</span>
              ) : (
                <span>Engine: Demo Mode (Rule-Based Sample)</span>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-[#E5E7F0] px-4 sm:px-8 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 text-[#141A2E] hover:bg-slate-100 rounded-lg"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline whitespace-nowrap">
                BrandLens
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="text-base sm:text-lg font-semibold text-[#141A2E] truncate">
                {PAGE_TITLES[activePage]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {selectedBrand && (
              <span className="hidden md:inline text-xs text-slate-500 whitespace-nowrap">
                Active brand: <strong className="font-medium text-[#141A2E]">{selectedBrand.brand_name}</strong>
              </span>
            )}
            <button
              type="button"
              onClick={() => onNavigate("checker")}
              className="px-4 py-2 rounded-lg bg-[#6B5CE7] hover:bg-[#5A4BD6] text-white text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6B5CE7]"
            >
              Check Content
            </button>
          </div>
        </header>

        {/* Demo Mode Notice Banner if Gemini API key is not active */}
        {health && health.ai_mode === "demo" && (
          <div className="bg-[#EEF6FF] border-b border-[#D2E6FF] px-4 sm:px-8 py-2.5 text-xs text-[#141A2E] flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Demo Mode Active:</strong> No Gemini API key is configured on the server, so BrandLens is running its rule-grounded sample analyzer. Add <code className="font-mono bg-white/80 px-1 py-0.5 rounded">GEMINI_API_KEY</code> on the server to enable live Gemini AI analysis.
            </span>
          </div>
        )}

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1280px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
