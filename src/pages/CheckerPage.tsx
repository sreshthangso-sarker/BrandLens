import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import type { Brand, HealthResponse } from "../types.ts";

interface CheckerPageProps {
  brands: Brand[];
  selectedBrandId: number | null;
  onSelectBrand: (id: number) => void;
  health: HealthResponse | null;
  onAnalyze: (payload: {
    brand_id: number;
    title: string;
    content_type: string;
    content: string;
    force_demo: boolean;
  }) => Promise<void>;
}

const CONTENT_TYPES = [
  "Social Media Post",
  "Advertisement",
  "Product Description",
  "General Text",
];

const SAMPLE_NON_COMPLIANT = {
  title: "NovaWear Spring Promo Post",
  content_type: "Social Media Post",
  content:
    "NovaWear is the cheapest fashion brand! Our products are 100% risk-free and guaranteed to change your life. Buy now and experience the best sustainable fashion.",
};

const SAMPLE_COMPLIANT = {
  title: "NovaWear Recycled Knitwear Launch",
  content_type: "Product Description",
  content:
    "Refresh your everyday wardrobe with NovaWear's latest sustainable fashion essentials. Thoughtfully crafted for modern comfort, our products are made with 70% recycled fabric so you can dress well with confidence.",
};

export function CheckerPage({
  brands,
  selectedBrandId,
  onSelectBrand,
  health,
  onAnalyze,
}: CheckerPageProps) {
  const effectiveBrandId = selectedBrandId ?? brands[0]?.id ?? 0;
  const activeBrand = brands.find((b) => b.id === effectiveBrandId);

  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState("Social Media Post");
  const [content, setContent] = useState("");
  const [forceDemo, setForceDemo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  const loadSample = (sample: typeof SAMPLE_NON_COMPLIANT) => {
    const novaWear = brands.find((b) => b.brand_name.toLowerCase() === "novawear");
    if (novaWear) {
      onSelectBrand(novaWear.id);
    }
    setTitle(sample.title);
    setContentType(sample.content_type);
    setContent(sample.content);
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!effectiveBrandId) {
      setError("Please select or create a brand profile first.");
      return;
    }
    if (!title.trim()) {
      setError("Please enter a title for the content.");
      return;
    }
    if (content.trim().length < 5) {
      setError("Please paste or write at least 5 characters of marketing content to analyse.");
      return;
    }

    setSubmitting(true);
    try {
      await onAnalyze({
        brand_id: effectiveBrandId,
        title: title.trim(),
        content_type: contentType,
        content: content.trim(),
        force_demo: forceDemo,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* Main Submission Form */}
      <form
        onSubmit={handleSubmit}
        className="lg:col-span-2 bg-white border border-[#E5E7F0] rounded-xl p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#E5E7F0]">
          <div>
            <h2 className="text-lg font-semibold text-[#141A2E]">Submit Content for Analysis</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Compare your draft against saved brand rules before publishing.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadSample(SAMPLE_NON_COMPLIANT)}
              className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-[#F7F8FC] hover:border-[#6B5CE7] text-xs font-medium text-[#141A2E] transition-colors whitespace-nowrap"
            >
              Load Non-Compliant Sample
            </button>
            <button
              type="button"
              onClick={() => loadSample(SAMPLE_COMPLIANT)}
              className="px-3 py-1.5 rounded-lg border border-[#D5D9E6] bg-[#F7F8FC] hover:border-emerald-600 text-xs font-medium text-[#141A2E] transition-colors whitespace-nowrap"
            >
              Load Compliant Sample
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-3 text-sm"
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="checker-brand"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              Brand Profile
            </label>
            <select
              id="checker-brand"
              value={effectiveBrandId}
              onChange={(e) => onSelectBrand(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] bg-white text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.brand_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="checker-type"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              Content Type
            </label>
            <select
              id="checker-type"
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] bg-white text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            >
              {CONTENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label
            htmlFor="checker-title"
            className="block text-xs font-semibold text-[#141A2E] mb-1.5"
          >
            Content Title *
          </label>
          <input
            id="checker-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., NovaWear Spring Launch Caption"
            className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="checker-content"
              className="block text-xs font-semibold text-[#141A2E]"
            >
              Marketing Content *
            </label>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {wordCount} words · {content.length} chars
            </span>
          </div>
          <textarea
            id="checker-content"
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste your marketing copy, social post, ad headline, or product description here..."
            className="w-full px-3.5 py-3 rounded-lg border border-[#D5D9E6] text-sm leading-relaxed text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
          />
        </div>

        <div className="pt-2 border-t border-[#E5E7F0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {health?.ai_mode === "gemini" ? (
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={forceDemo}
                onChange={(e) => setForceDemo(e.target.checked)}
                className="rounded border-slate-300 text-[#6B5CE7] focus:ring-[#6B5CE7]"
              />
              Run in Demo Mode (rule-based sample check)
            </label>
          ) : (
            <span className="text-xs text-slate-500">
              Running in Demo Mode (rule-based sample analysis)
            </span>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 rounded-lg bg-[#6B5CE7] hover:bg-[#5A4BD6] disabled:opacity-60 text-white text-sm font-medium transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analysing Content...
              </>
            ) : (
              <>
                <ScanSearch className="w-4 h-4" />
                Analyse Content
              </>
            )}
          </button>
        </div>
      </form>

      {/* Active Brand Guidelines Reference Panel */}
      <aside className="bg-white border border-[#E5E7F0] rounded-xl p-6 space-y-4">
        <div>
          <div className="text-xs font-medium text-[#4DA6FF]">Active Guidelines Reference</div>
          <h3 className="text-base font-semibold text-[#141A2E] mt-0.5">
            {activeBrand?.brand_name ?? "No brand selected"}
          </h3>
          {activeBrand?.description && (
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              {activeBrand.description}
            </p>
          )}
        </div>

        {activeBrand && (
          <dl className="space-y-3 text-xs border-t border-[#E5E7F0] pt-4">
            <div>
              <dt className="font-semibold text-[#141A2E]">Preferred Tone</dt>
              <dd className="text-slate-600 mt-0.5">{activeBrand.tone || "None set"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#141A2E]">Preferred Terms</dt>
              <dd className="text-slate-600 mt-0.5">{activeBrand.preferred_terms || "None set"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-rose-700">Prohibited Terms</dt>
              <dd className="text-slate-600 mt-0.5">{activeBrand.prohibited_terms || "None set"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#141A2E]">Approved Facts</dt>
              <dd className="text-slate-600 mt-0.5">{activeBrand.approved_facts || "None set"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#141A2E]">General Guidelines</dt>
              <dd className="text-slate-600 mt-0.5">{activeBrand.guidelines || "None set"}</dd>
            </div>
          </dl>
        )}
      </aside>
    </div>
  );
}
