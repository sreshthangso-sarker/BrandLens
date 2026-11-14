import type {
  AnalysisDetailResponse,
  AnalysisIssue,
  ApprovalStatus,
  Brand,
  BrandInput,
  ContentItem,
  CorrectionDecision,
  DashboardStats,
  GuidelineSuggestion,
  HealthResponse,
  HistoryItem,
  IngestResponse,
  IngestSourceType,
  IssueDecision,
} from "../types.ts";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options?.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data && (data.error || data.detail)) ||
      `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  getHealth: () => request<HealthResponse>("/api/health"),

  getBrands: () => request<{ brands: Brand[] }>("/api/brands"),

  createBrand: (payload: BrandInput) =>
    request<{ brand: Brand }>("/api/brands", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getBrand: (id: number) => request<{ brand: Brand }>(`/api/brands/${id}`),

  updateBrand: (id: number, payload: BrandInput) =>
    request<{ brand: Brand }>(`/api/brands/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  ingestText: (text: string, sourceName = "Direct Text Input") =>
    request<IngestResponse>("/api/ingest", {
      method: "POST",
      body: JSON.stringify({
        source_type: "text",
        text,
        source_name: sourceName,
      }),
    }),

  ingestUrl: (url: string) =>
    request<IngestResponse>("/api/ingest", {
      method: "POST",
      body: JSON.stringify({
        source_type: "url",
        url,
      }),
    }),

  ingestFile: (file: File, sourceType: Extract<IngestSourceType, "pdf" | "image">) => {
    const formData = new FormData();
    formData.append("source_type", sourceType);
    formData.append("file", file);
    return request<IngestResponse>("/api/ingest", {
      method: "POST",
      body: formData,
    });
  },

  analyzeContent: (payload: {
    brand_id: number;
    title?: string;
    content_type?: string;
    source_type?: string;
    detected_language?: string;
    content: string;
    force_demo?: boolean;
  }) =>
    request<AnalysisDetailResponse>("/api/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getHistory: () =>
    request<{ items: HistoryItem[]; stats: DashboardStats }>("/api/history"),

  resetHistory: () =>
    request<{ success: boolean; deleted_count: number; stats: DashboardStats }>(
      "/api/history",
      { method: "DELETE" }
    ),

  getAnalysisDetail: (id: number) =>
    request<AnalysisDetailResponse>(`/api/history/${id}`),

  saveReview: (
    id: number,
    payload: {
      approval_status?: ApprovalStatus;
      corrected_content?: string;
      final_content?: string;
      review_notes?: string;
    }
  ) =>
    request<{ content: ContentItem }>(`/api/review/${id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  reviewIssue: (
    issueId: number,
    payload: {
      decision?: IssueDecision;
      reviewer_reason?: string;
      correction_decision?: CorrectionDecision;
      final_corrected_text?: string;
    }
  ) =>
    request<{ review: unknown; issues: AnalysisIssue[] }>(`/api/review/${issueId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  approveContent: (
    contentId: number,
    payload: {
      approval_status?: ApprovalStatus;
      corrected_content?: string;
      final_content?: string;
      review_notes?: string;
    }
  ) =>
    request<{ content: ContentItem }>(`/api/approve-content/${contentId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  generateGuidelineSuggestions: (brandId: number) =>
    request<{
      suggestions: GuidelineSuggestion[];
      generated_count: number;
      mode?: string;
      message?: string;
    }>("/api/guidelines/suggestions", {
      method: "POST",
      body: JSON.stringify({ brand_id: brandId }),
    }),

  getGuidelineSuggestions: (brandId: number) =>
    request<{ suggestions: GuidelineSuggestion[] }>(
      `/api/guidelines/suggestions/${brandId}`
    ),

  approveGuidelineSuggestion: (id: number, proposedGuideline?: string) =>
    request<{ suggestion: GuidelineSuggestion; brand: Brand }>(
      `/api/guidelines/suggestions/${id}/approve`,
      {
        method: "POST",
        body: JSON.stringify(
          proposedGuideline !== undefined
            ? { proposed_guideline: proposedGuideline }
            : {}
        ),
      }
    ),

  rejectGuidelineSuggestion: (id: number, reason?: string) =>
    request<{ suggestion: GuidelineSuggestion }>(
      `/api/guidelines/suggestions/${id}/reject`,
      {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      }
    ),
};
