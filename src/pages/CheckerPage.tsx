import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  Check,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  ScanSearch,
  Type as TypeIcon,
  Upload,
} from "lucide-react";
import type { Brand, HealthResponse, IngestResponse, IngestSourceType } from "../types.ts";
import { api } from "../services/api.ts";

interface CheckerPageProps {
  brands: Brand[];
  selectedBrandId: number | null;
  onSelectBrand: (id: number) => void;
  health: HealthResponse | null;
  onAnalyze: (payload: {
    brand_id: number;
    title: string;
    content_type: string;
    source_type: string;
    detected_language: string;
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

const SOURCE_TABS: Array<{
  id: IngestSourceType;
  label: string;
  icon: typeof TypeIcon;
}> = [
  { id: "text", label: "Direct Text", icon: TypeIcon },
  { id: "url", label: "Website URL", icon: Globe },
  { id: "pdf", label: "PDF Upload", icon: FileText },
  { id: "image", label: "Image Upload", icon: ImageIcon },
];

const LANGUAGE_OPTIONS = ["Auto", "English", "Hindi", "Bengali", "Mixed"];

const SAMPLE_NON_COMPLIANT = {
  title: "NovaWear Spring Promo Post",
  content_type: "Social Media Post",
  source_type: "text" as IngestSourceType,
  detected_language: "English",
  content:
    "NovaWear is the cheapest fashion brand! Our products are 100% risk-free and guaranteed to change your life. Buy now and experience the best sustainable fashion.",
};

const SAMPLE_COMPLIANT = {
  title: "NovaWear Recycled Knitwear Launch",
  content_type: "Product Description",
  source_type: "text" as IngestSourceType,
  detected_language: "English",
  content:
    "Refresh your everyday wardrobe with NovaWear's latest sustainable fashion essentials. Thoughtfully crafted for modern comfort, our products are made with 70% recycled fabric so you can dress well with confidence.",
};

const SAMPLE_HINDI = {
  title: "NovaWear Hindi Campaign Draft",
  content_type: "Advertisement",
  source_type: "text" as IngestSourceType,
  detected_language: "Hindi",
  content:
    "NovaWear सबसे सस्ता फैशन ब्रांड है! हमारे उत्पाद 100% जोखिम-मुक्त हैं और आपकी ज़िंदगी बदल देगा। अभी खरीदें!",
};

const SAMPLE_BENGALI = {
  title: "NovaWear Bengali Launch Post",
  content_type: "Social Media Post",
  source_type: "text" as IngestSourceType,
  detected_language: "Bengali",
  content:
    "NovaWear হলো সবচেয়ে সস্তা ফ্যাশন ব্র্যান্ড! আমাদের পোশাক ১০০% ঝুঁকিমুক্ত এবং আপনার জীবন বদলে দেবে। এখনই কিনুন!",
};

const SAMPLE_MIXED = {
  title: "NovaWear Hinglish Promo",
  content_type: "Social Media Post",
  source_type: "text" as IngestSourceType,
  detected_language: "Mixed",
  content:
    "NovaWear का नया sustainable fashion collection आ गया है। यह 100% risk-free है और our products are made with 70% recycled fabric. Buy now!",
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

  const [sourceType, setSourceType] = useState<IngestSourceType>("text");
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState("Social Media Post");
  const [detectedLanguage, setDetectedLanguage] = useState("Auto");
  const [content, setContent] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const [ingestMeta, setIngestMeta] = useState<IngestResponse | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [forceDemo, setForceDemo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  const resetSourceState = (nextSource: IngestSourceType) => {
    setSourceType(nextSource);
    setSelectedFile(null);
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
    setIngestMeta(null);
    setError(null);
    setNotice(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const loadSample = (sample: typeof SAMPLE_NON_COMPLIANT) => {
    const novaWear = brands.find((b) => b.brand_name.toLowerCase() === "novawear");
    if (novaWear) {
      onSelectBrand(novaWear.id);
    }
    resetSourceState("text");
    setTitle(sample.title);
    setContentType(sample.content_type);
    setDetectedLanguage(sample.detected_language);
    setContent(sample.content);
  };

  const applyIngestResult = (res: IngestResponse) => {
    setIngestMeta(res);
    setContent(res.extracted_text);
    setDetectedLanguage(res.detected_language);
    if (!title.trim() && res.title) {
      setTitle(res.title);
    } else if (!title.trim() && res.source_name) {
      setTitle(res.source_name);
    }
    setNotice(`${res.message} — Detected language: ${res.detected_language}.`);
  };

  const handleExtractUrl = async () => {
    setError(null);
    setNotice(null);
    if (!urlInput.trim()) {
      setError("Please enter a publicly accessible webpage URL.");
      return;
    }
    setIngesting(true);
    try {
      const res = await api.ingestUrl(urlInput.trim());
      applyIngestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract webpage content.");
    } finally {
      setIngesting(false);
    }
  };

  const handleFileExtraction = async (
    file: File,
    kind: Extract<IngestSourceType, "pdf" | "image">
  ) => {
    setError(null);
    setNotice(null);
    setIngesting(true);
    try {
      const res = await api.ingestFile(file, kind);
      applyIngestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract file content.");
    } finally {
      setIngesting(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
    setSelectedFile(file);
    setIngestMeta(null);
    setError(null);
    setNotice(null);

    if (!file) return;
    if (sourceType === "image") {
      setImagePreviewUrl(URL.createObjectURL(file));
    }
    if (sourceType === "pdf" || sourceType === "image") {
      void handleFileExtraction(file, sourceType);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!effectiveBrandId) {
      setError("Please select or create a brand profile first.");
      return;
    }
    if (content.trim().length < 5) {
      setError(
        sourceType === "text"
          ? "Please paste or write at least 5 characters of marketing content to analyse."
          : "Extract content from your selected source first (minimum 5 characters required)."
      );
      return;
    }

    setSubmitting(true);
    try {
      let textToAnalyze = content.trim();
      let finalLanguage = detectedLanguage;

      if (sourceType === "text") {
        const ingested = await api.ingestText(
          content,
          title.trim() || "Direct Text Input"
        );
        textToAnalyze = ingested.extracted_text;
        if (detectedLanguage === "Auto") {
          finalLanguage = ingested.detected_language;
        }
      } else if (finalLanguage === "Auto" && ingestMeta?.detected_language) {
        finalLanguage = ingestMeta.detected_language;
      }

      const resolvedTitle =
        title.trim() ||
        ingestMeta?.title ||
        `${sourceType.toUpperCase()} Check — ${textToAnalyze.slice(0, 42)}`;

      await onAnalyze({
        brand_id: effectiveBrandId,
        title: resolvedTitle,
        content_type: contentType,
        source_type: sourceType,
        detected_language: finalLanguage,
        content: textToAnalyze,
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
        <div className="space-y-3 pb-4 border-b border-[#E5E7F0]">
          <div>
            <h2 className="text-lg font-semibold text-[#141A2E]">
              Multiformat Content Ingestion & Analysis
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Submit English, Hindi, Bengali, or mixed-language content via direct text, webpage URL, PDF, or image upload.
            </p>
          </div>

          {/* 4-Method Input Switcher */}
          <div
            role="tablist"
            aria-label="Content input method"
            className="grid grid-cols-2 sm:grid-cols-4 gap-2"
          >
            {SOURCE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = sourceType === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => resetSourceState(tab.id)}
                  className={`px-3 py-2 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                    active
                      ? "border-[#6B5CE7] bg-[#6B5CE7]/10 text-[#6B5CE7]"
                      : "border-[#D5D9E6] bg-white hover:bg-slate-50 text-[#141A2E]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Sample Presets */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-medium text-slate-500">Quick samples:</span>
            <button
              type="button"
              onClick={() => loadSample(SAMPLE_NON_COMPLIANT)}
              className="px-2.5 py-1 rounded-lg border border-[#D5D9E6] bg-[#F7F8FC] hover:border-[#6B5CE7] text-xs font-medium text-[#141A2E] transition-colors whitespace-nowrap"
            >
              English Non-Compliant
            </button>
            <button
              type="button"
              onClick={() => loadSample(SAMPLE_COMPLIANT)}
              className="px-2.5 py-1 rounded-lg border border-[#D5D9E6] bg-[#F7F8FC] hover:border-emerald-600 text-xs font-medium text-[#141A2E] transition-colors whitespace-nowrap"
            >
              English Compliant
            </button>
            <button
              type="button"
              onClick={() => loadSample(SAMPLE_HINDI)}
              className="px-2.5 py-1 rounded-lg border border-[#D5D9E6] bg-[#F7F8FC] hover:border-[#4DA6FF] text-xs font-medium text-[#141A2E] transition-colors whitespace-nowrap"
            >
              Hindi Sample
            </button>
            <button
              type="button"
              onClick={() => loadSample(SAMPLE_BENGALI)}
              className="px-2.5 py-1 rounded-lg border border-[#D5D9E6] bg-[#F7F8FC] hover:border-[#4DA6FF] text-xs font-medium text-[#141A2E] transition-colors whitespace-nowrap"
            >
              Bengali Sample
            </button>
            <button
              type="button"
              onClick={() => loadSample(SAMPLE_MIXED)}
              className="px-2.5 py-1 rounded-lg border border-[#D5D9E6] bg-[#F7F8FC] hover:border-[#6B5CE7] text-xs font-medium text-[#141A2E] transition-colors whitespace-nowrap"
            >
              Mixed Hindi-English
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

        {notice && !error && (
          <div
            role="status"
            className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 text-xs flex items-center gap-2"
          >
            <Check className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{notice}</span>
          </div>
        )}

        {/* Source-Specific Extraction Controls */}
        {sourceType === "url" && (
          <div className="bg-[#F7F8FC] border border-[#E5E7F0] rounded-xl p-4 space-y-2.5">
            <label
              htmlFor="checker-url"
              className="block text-xs font-semibold text-[#141A2E]"
            >
              Public Webpage URL
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="checker-url"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/product-announcement"
                className="flex-1 px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] bg-white text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
              />
              <button
                type="button"
                disabled={ingesting}
                onClick={handleExtractUrl}
                className="px-4 py-2.5 rounded-lg bg-[#141A2E] hover:bg-[#1E2642] disabled:opacity-60 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {ingesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <Globe className="w-3.5 h-3.5" />
                    Extract Webpage
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Extracts the page title and main readable article text while stripping navigation, scripts, and ads. Private/localhost URLs are blocked.
            </p>
          </div>
        )}

        {(sourceType === "pdf" || sourceType === "image") && (
          <div className="bg-[#F7F8FC] border border-dashed border-[#D5D9E6] rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#141A2E]">
                  {sourceType === "pdf"
                    ? "Upload PDF Document (English, Hindi, or Bengali)"
                    : "Upload Image (PNG, JPG, JPEG — English, Hindi, or Bengali)"}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {sourceType === "pdf"
                    ? "Extracts Unicode text directly and runs OCR on scanned PDFs when available (max 10 MB)."
                    : "Extracts visible text in its original script without translating (max 10 MB)."}
                </p>
              </div>

              <label className="px-3.5 py-2 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0">
                <Upload className="w-3.5 h-3.5" />
                {selectedFile ? "Replace File" : sourceType === "pdf" ? "Choose PDF" : "Choose Image"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={sourceType === "pdf" ? ".pdf,application/pdf" : ".png,.jpg,.jpeg,image/png,image/jpeg"}
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
            </div>

            {selectedFile && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E5E7F0] text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  {imagePreviewUrl && (
                    <img
                      src={imagePreviewUrl}
                      alt="Uploaded content preview"
                      className="w-12 h-12 object-cover rounded border border-[#E5E7F0] shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-[#141A2E] truncate">
                      {selectedFile.name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                      {ingesting ? " · Extracting text..." : ""}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={ingesting}
                  onClick={() => handleFileExtraction(selectedFile, sourceType)}
                  className="px-3 py-1.5 rounded-lg bg-[#141A2E] hover:bg-[#1E2642] disabled:opacity-60 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {ingesting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    "Re-extract Text"
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

          <div>
            <label
              htmlFor="checker-language"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              Language
            </label>
            <select
              id="checker-language"
              value={
                LANGUAGE_OPTIONS.includes(detectedLanguage)
                  ? detectedLanguage
                  : "Mixed"
              }
              onChange={(e) => setDetectedLanguage(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] bg-white text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            >
              {LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang} value={lang}>
                  {lang === "Auto" ? "Auto-Detect" : lang}
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
            Content Title
          </label>
          <input
            id="checker-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Auto-filled from URL/file or enter a custom title..."
            className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="checker-content"
              className="block text-xs font-semibold text-[#141A2E]"
            >
              {sourceType === "text"
                ? "Marketing Content *"
                : "Extracted Content (Original Script Preserved) *"}
            </label>
            <div className="flex items-center gap-3 text-xs text-slate-500 font-mono tabular-nums">
              {ingestMeta && (
                <span className="text-[#6B5CE7] font-sans font-medium">
                  Detected: {ingestMeta.detected_language}
                </span>
              )}
              <span>
                {wordCount} words · {content.length} chars
              </span>
            </div>
          </div>
          <textarea
            id="checker-content"
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              sourceType === "text"
                ? "Paste your English, Hindi, Bengali, or mixed-language marketing copy here..."
                : "Extracted text will appear here in its original language and script before analysis..."
            }
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
            disabled={submitting || ingesting}
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
