import type {
  AnalysisDetailResponse,
  ApprovalStatus,
  Brand,
  BrandInput,
  ContentItem,
  DashboardStats,
  HealthResponse,
  HistoryItem,
} from "../types.ts";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    ...options,
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

  analyzeContent: (payload: {
    brand_id: number;
    title: string;
    content_type: string;
    content: string;
    force_demo?: boolean;
  }) =>
    request<AnalysisDetailResponse>("/api/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getHistory: () =>
    request<{ items: HistoryItem[]; stats: DashboardStats }>("/api/history"),

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
};
