export type AnalysisStatus = "Compliant" | "Needs Review" | "Non-Compliant";
export type ApprovalStatus =
  | "Pending Review"
  | "Approved Original"
  | "Approved Corrected"
  | "Rejected";
export type SeverityLevel = "High" | "Medium" | "Low";
export type PageView =
  | "dashboard"
  | "guidelines"
  | "checker"
  | "results"
  | "review"
  | "history";

export interface Brand {
  id: number;
  brand_name: string;
  description: string;
  tone: string;
  preferred_terms: string;
  prohibited_terms: string;
  approved_facts: string;
  guidelines: string;
  created_at: string;
}

export interface BrandInput {
  brand_name: string;
  description: string;
  tone: string;
  preferred_terms: string;
  prohibited_terms: string;
  approved_facts: string;
  guidelines: string;
}

export interface ContentItem {
  id: number;
  brand_id: number;
  title: string;
  content_type: string;
  original_content: string;
  corrected_content: string;
  final_content: string;
  analysis_status: AnalysisStatus;
  approval_status: ApprovalStatus;
  analysis_mode: "gemini" | "demo";
  review_notes: string;
  created_at: string;
}

export interface AnalysisIssue {
  id: number;
  content_id: number;
  issue_type: string;
  severity: SeverityLevel;
  original_text: string;
  brand_rule: string;
  explanation: string;
  suggested_correction: string;
  rule_reference: string;
}

export interface HistoryItem extends ContentItem {
  brand_name: string;
  issue_count: number;
}

export interface DashboardStats {
  total_analyzed: number;
  compliant_count: number;
  needs_review_count: number;
  non_compliant_count: number;
  pending_approval_count: number;
  approved_count: number;
  rejected_count: number;
}

export interface AnalysisDetailResponse {
  content: ContentItem;
  brand: Brand;
  issues: AnalysisIssue[];
  analysis_mode?: "gemini" | "demo";
  fallback_reason?: string;
}

export interface HealthResponse {
  status: string;
  database: string;
  ai_mode: "gemini" | "demo";
  model: string;
}
