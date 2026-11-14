import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Check, Plus, Save } from "lucide-react";
import type { Brand, BrandInput } from "../types.ts";

interface GuidelinesPageProps {
  brands: Brand[];
  selectedBrandId: number | null;
  onSelectBrand: (id: number) => void;
  onUpdateBrand: (id: number, payload: BrandInput) => Promise<void>;
  onCreateBrand: (payload: BrandInput) => Promise<void>;
}

const EMPTY_FORM: BrandInput = {
  brand_name: "",
  description: "",
  tone: "",
  preferred_terms: "",
  prohibited_terms: "",
  approved_facts: "",
  guidelines: "",
};

const TONE_SUGGESTIONS = [
  "Friendly, modern and professional",
  "Formal and authoritative",
  "Warm and conversational",
  "Concise and technical",
];

export function GuidelinesPage({
  brands,
  selectedBrandId,
  onSelectBrand,
  onUpdateBrand,
  onCreateBrand,
}: GuidelinesPageProps) {
  const activeBrand = brands.find((b) => b.id === selectedBrandId) ?? brands[0];
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<BrandInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isCreating && activeBrand) {
      setForm({
        brand_name: activeBrand.brand_name,
        description: activeBrand.description,
        tone: activeBrand.tone,
        preferred_terms: activeBrand.preferred_terms,
        prohibited_terms: activeBrand.prohibited_terms,
        approved_facts: activeBrand.approved_facts,
        guidelines: activeBrand.guidelines,
      });
    }
  }, [activeBrand, isCreating]);

  const handleStartCreate = () => {
    setIsCreating(true);
    setForm(EMPTY_FORM);
    setError(null);
    setSavedMessage(null);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setError(null);
    if (activeBrand) {
      setForm({
        brand_name: activeBrand.brand_name,
        description: activeBrand.description,
        tone: activeBrand.tone,
        preferred_terms: activeBrand.preferred_terms,
        prohibited_terms: activeBrand.prohibited_terms,
        approved_facts: activeBrand.approved_facts,
        guidelines: activeBrand.guidelines,
      });
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedMessage(null);

    if (!form.brand_name.trim()) {
      setError("Brand name is required.");
      return;
    }

    setSaving(true);
    try {
      if (isCreating) {
        await onCreateBrand(form);
        setIsCreating(false);
        setSavedMessage(`Created brand profile "${form.brand_name.trim()}" in SQLite.`);
      } else if (activeBrand) {
        await onUpdateBrand(activeBrand.id, form);
        setSavedMessage(`Saved guideline updates for "${form.brand_name.trim()}".`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save brand guidelines.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header / Brand Switcher */}
      <div className="bg-white border border-[#E5E7F0] rounded-xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#141A2E]">
            {isCreating ? "Create New Brand Profile" : "Manage Brand Guidelines"}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            All guidelines configured here are saved in SQLite and passed to the analyser on every check.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!isCreating && brands.length > 0 && (
            <select
              aria-label="Select brand to edit"
              value={activeBrand?.id ?? ""}
              onChange={(e) => {
                setSavedMessage(null);
                setError(null);
                onSelectBrand(Number(e.target.value));
              }}
              className="px-3 py-2 rounded-lg border border-[#D5D9E6] bg-white text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.brand_name}
                </option>
              ))}
            </select>
          )}

          {isCreating ? (
            <button
              type="button"
              onClick={handleCancelCreate}
              className="px-3.5 py-2 rounded-lg border border-[#D5D9E6] text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartCreate}
              className="px-3.5 py-2 rounded-lg border border-[#D5D9E6] bg-white hover:bg-slate-50 text-xs font-medium text-[#141A2E] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              New Brand
            </button>
          )}
        </div>
      </div>

      {/* Feedback Messages */}
      {error && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}

      {savedMessage && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-sm flex items-center gap-2"
        >
          <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{savedMessage}</span>
        </div>
      )}

      {/* Brand Guideline Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-[#E5E7F0] rounded-xl p-6 space-y-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="brand-name"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              Brand Name *
            </label>
            <input
              id="brand-name"
              type="text"
              required
              value={form.brand_name}
              onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
              placeholder="e.g., NovaWear"
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            />
          </div>

          <div>
            <label
              htmlFor="brand-tone"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              Preferred Tone
            </label>
            <input
              id="brand-tone"
              type="text"
              value={form.tone}
              onChange={(e) => setForm({ ...form, tone: e.target.value })}
              placeholder="e.g., Friendly, modern and professional"
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TONE_SUGGESTIONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setForm({ ...form, tone: preset })}
                  className="text-[11px] px-2 py-1 rounded border border-[#E5E7F0] bg-[#F7F8FC] hover:border-[#4DA6FF] text-slate-600 hover:text-[#141A2E] transition-colors"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label
            htmlFor="brand-description"
            className="block text-xs font-semibold text-[#141A2E] mb-1.5"
          >
            Brand Description
          </label>
          <textarea
            id="brand-description"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Brief description of what the brand represents and its positioning..."
            className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="preferred-terms"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              Preferred Words and Phrases
            </label>
            <textarea
              id="preferred-terms"
              rows={3}
              value={form.preferred_terms}
              onChange={(e) => setForm({ ...form, preferred_terms: e.target.value })}
              placeholder="Comma-separated preferred terms, e.g. Sustainable fashion"
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Separate multiple phrases with commas.
            </p>
          </div>

          <div>
            <label
              htmlFor="prohibited-terms"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              Prohibited Words and Phrases
            </label>
            <textarea
              id="prohibited-terms"
              rows={3}
              value={form.prohibited_terms}
              onChange={(e) => setForm({ ...form, prohibited_terms: e.target.value })}
              placeholder="Comma-separated banned words, e.g. Cheapest, guaranteed, 100% risk-free"
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Any occurrence triggers a High severity violation.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="approved-facts"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              Approved Facts and Claims
            </label>
            <textarea
              id="approved-facts"
              rows={3}
              value={form.approved_facts}
              onChange={(e) => setForm({ ...form, approved_facts: e.target.value })}
              placeholder="Verified facts the copy can state, e.g. Products are made with 70% recycled fabric."
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            />
          </div>

          <div>
            <label
              htmlFor="general-guidelines"
              className="block text-xs font-semibold text-[#141A2E] mb-1.5"
            >
              General Writing Guidelines
            </label>
            <textarea
              id="general-guidelines"
              rows={3}
              value={form.guidelines}
              onChange={(e) => setForm({ ...form, guidelines: e.target.value })}
              placeholder="e.g. Avoid exaggerated marketing claims."
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#D5D9E6] text-sm text-[#141A2E] focus:outline-none focus:border-[#4DA6FF]"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-[#E5E7F0] flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-[#6B5CE7] hover:bg-[#5A4BD6] disabled:opacity-60 text-white text-sm font-medium transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Save className="w-4 h-4" />
            {saving
              ? "Saving..."
              : isCreating
                ? "Create Brand Profile"
                : "Save Guidelines"}
          </button>
        </div>
      </form>
    </div>
  );
}
